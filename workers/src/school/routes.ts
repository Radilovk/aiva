/**
 * School feedback platform API, mounted at /api/sf (port of school-feedback/api.py onto D1).
 *
 * Design rules
 * - Respondents never authenticate as persons. A one-time anonymous code fixes wave, school, class, grade and
 *   role; only its SHA-256 hash is stored, and it is marked used on submit.
 * - Raw responses never leave the server. Read endpoints return aggregates from engine.ts, already filtered
 *   by k-anonymity and further by the caller's scope (Authorization: Bearer <key>):
 *     public        system, region, school
 *     researcher    + class (no teacher level)
 *     school_admin  + class and teacher units of ONE school
 *     teacher       ONLY own teacher unit
 *     admin         everything + waves, classes, codes, keys, compute (SF_ADMIN_KEY secret or an admin key)
 * - No names, e-mails, phones or IP addresses are stored. Failed code attempts are counted per hashed IP and
 *   day in KV (expires after a day) to stop guessing.
 */
import { Hono, type Context } from 'hono';
import {
  assignTeachers, flow, isYoung, loadQuestionnaire, runWave, scoreRespondent, simulate, stageOf,
  type Answers, type Response as SfResponse, type Teacher,
} from './engine';

export interface SfEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  SF_ADMIN_KEY?: string;
  SF_BOOTSTRAP_REPS?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dict<T = any> = Record<string, T>;
type C = Context<{ Bindings: SfEnv }>;

const Q = loadQuestionnaire();
const LEVELS = ['system', 'region', 'school', 'class', 'teacher'] as const;
const MAX_FAILED_CODES_PER_DAY = 30;

/** Question ids that other questions' show_if depends on: the client re-asks /flow only after answering these. */
const TRIGGERS = (() => {
  const out = new Set<string>();
  const walk = (c: any) => {
    if (!c || typeof c !== 'object') return;
    if (typeof c.q === 'string') out.add(c.q);
    for (const k of ['all', 'any']) if (Array.isArray(c[k])) c[k].forEach(walk);
    if (c.not) walk(c.not);
  };
  Q.items.forEach((it) => walk(it.show_if));
  return [...out];
})();

// =============================================================================== storage
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sf_waves (id TEXT PRIMARY KEY, title TEXT, demo INTEGER DEFAULT 0, open INTEGER DEFAULT 1,
     created_at TEXT DEFAULT (datetime('now')), computed_at TEXT, meta TEXT)`,
  `CREATE TABLE IF NOT EXISTS sf_classes (wave_id TEXT NOT NULL, class_id TEXT NOT NULL, school_id TEXT NOT NULL,
     region_id TEXT NOT NULL, grade INTEGER NOT NULL, class_size INTEGER, roster TEXT, PRIMARY KEY (wave_id, class_id))`,
  `CREATE TABLE IF NOT EXISTS sf_names (level TEXT NOT NULL, unit_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (level, unit_id))`,
  `CREATE TABLE IF NOT EXISTS sf_codes (hash TEXT PRIMARY KEY, wave_id TEXT NOT NULL, class_id TEXT NOT NULL, role TEXT NOT NULL,
     used INTEGER DEFAULT 0, teachers TEXT)`,
  `CREATE TABLE IF NOT EXISTS sf_responses (id TEXT PRIMARY KEY, wave_id TEXT NOT NULL, payload TEXT NOT NULL, day TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sf_responses_wave ON sf_responses (wave_id)`,
  `CREATE TABLE IF NOT EXISTS sf_units (wave_id TEXT NOT NULL, level TEXT NOT NULL, unit_id TEXT NOT NULL, parent_id TEXT,
     data TEXT NOT NULL, PRIMARY KEY (wave_id, level, unit_id))`,
  `CREATE INDEX IF NOT EXISTS idx_sf_units_unit ON sf_units (level, unit_id)`,
  `CREATE TABLE IF NOT EXISTS sf_rating_counts (teacher_id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sf_keys (hash TEXT PRIMARY KEY, scope TEXT NOT NULL, school_id TEXT, teacher_id TEXT, label TEXT,
     created_at TEXT DEFAULT (datetime('now')))`,
];
let schemaReady: Promise<unknown> | null = null;
function ensureSchema(db: D1Database) {
  schemaReady ??= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const normCode = (code: unknown) => String(code ?? '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
const codeHash = (code: string) => sha256('sf-code|' + normCode(code));

function newCode(): string {
  // 12 characters from an alphabet without look-alikes (0/O, 1/I/L): ~59 bits, printed as XXXX-XXXX-XXXX
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => A[b % A.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const newKey = () => 'sfk_' + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

interface Key { scope: string; school_id?: string | null; teacher_id?: string | null; label?: string | null }

async function callerKey(c: C): Promise<Key> {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header('Authorization') || '');
  if (!m) return { scope: 'public' };
  const token = m[1].trim();
  if (c.env.SF_ADMIN_KEY && safeEqual(token, c.env.SF_ADMIN_KEY)) return { scope: 'admin', label: 'оператор' };
  const row = await c.env.DB.prepare('SELECT scope, school_id, teacher_id, label FROM sf_keys WHERE hash = ?')
    .bind(await sha256('sf-key|' + token)).first<Key>();
  return row || { scope: 'invalid' };
}

// =============================================================================== scope filtering
function canSee(key: Key, level: string, unit: Dict): boolean {
  const sc = key.scope;
  if (sc === 'admin') return true;
  if (sc === 'teacher') return level === 'teacher' && unit.unit_id === key.teacher_id;
  if (level === 'system' || level === 'region' || level === 'school') return true;
  if (sc === 'researcher') return level === 'class';
  if (sc === 'school_admin') return (level === 'class' || level === 'teacher') && unit.parent_id === key.school_id;
  return false;
}

/** What leaves the server: blocked units are withheld. */
function publicView(level: string, unit: Dict): Dict {
  if (unit.publish_blocked) return { unit_id: unit.unit_id, level, withheld: unit.publish_blocked };
  return unit;
}

function summary(x: Dict): Dict {
  if (x.withheld) return x;
  return { unit_id: x.unit_id, name: x.name, parent_id: x.parent_id, parent_name: x.parent_name, stage: x.stage,
    n_respondents: x.n_respondents, index: x.index, pillars: x.pillars, representativeness: x.representativeness ?? 'ok',
    tc: x.dimensions?.TC ? { score: x.dimensions.TC.score, lo: x.dimensions.TC.lo, hi: x.dimensions.TC.hi } : undefined };
}

// =============================================================================== free-text themes (redacted)
const EMAIL = /\S+@\S+/g;
const PHONE = /\+?\d[\d\s-]{6,}\d/g;
const HONORIFIC = /(^|[^\p{L}])(г-жа|г-н|госпожа|господин|учителката|учителят)\s+[А-ЯЁЍ][а-яёѝ]+/giu;
const CAPWORD = /(?<![.!?]\s)(?<!^)(?<![\p{L}])[А-Я][а-я]{2,}(?![\p{L}])/gu;
const THEMES: Dict<string[]> = {
  'обем на домашните': ['домашн', 'задачи', 'натовар', 'много за пис'],
  'уикенд и ваканции': ['уикенд', 'събота', 'неделя', 'ваканци'],
  'дисциплина и наказания': ['наказ', 'агрес', 'бележк', 'забележк', 'крещ', 'вик'],
  'сън и умора': ['сън', 'спи', 'умор', 'изтощ', 'късно'],
  'уважение и отношение': ['уважен', 'униж', 'засрам', 'отношени'],
  'комуникация с родителите': ['комуникац', 'родителск', 'информ', 'отговар', 'среща'],
  'качество на преподаването': ['обясн', 'преподав', 'разбир', 'интерес'],
  'тормоз и безопасност': ['тормоз', 'обижд', 'удря', 'бият', 'безопас'],
  'положително': ['харесв', 'доволн', 'благодар', 'прекрас', 'добр'],
};

export function redact(text: string): string {
  return text.replace(EMAIL, '[имейл]').replace(PHONE, '[телефон]')
    .replace(HONORIFIC, (_m, pre, hon) => `${pre}${hon} [име]`).replace(CAPWORD, '[име]');
}

function themesFor(responses: SfResponse[]): Dict {
  const counts: Dict<number> = {};
  let n = 0;
  for (const r of responses) {
    const texts = ['OT01', 'OT02', 'OT03'].map((k) => r.answers[k]).filter((x): x is string => typeof x === 'string' && !!x.trim());
    if (!texts.length) continue;
    n += 1;
    const low = redact(texts.join(' ')).toLowerCase();
    for (const [theme, stems] of Object.entries(THEMES)) if (stems.some((s) => low.includes(s))) counts[theme] = (counts[theme] || 0) + 1;
  }
  return { respondents_with_text: n, themes: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])) };
}

// =============================================================================== app
export const sf = new Hono<{ Bindings: SfEnv }>();

sf.use('*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
  c.header('Cache-Control', 'no-store');
});

sf.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);
  const client = err instanceof HttpError;
  if (!client) console.error('sf error', msg);
  return c.json({ error: client ? msg : 'Вътрешна грешка. Опитайте отново.' }, client ? (err as HttpError).status : 500);
});

class HttpError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 410 | 429, message: string) { super(message); }
}

async function body(c: C): Promise<Dict> {
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > 256 * 1024) throw new HttpError(400, 'Заявката е твърде голяма.');
  try { return (await c.req.json()) || {}; } catch { throw new HttpError(400, 'Невалиден JSON.'); }
}

// ------------------------------------------------------------------ respondent: code -> session -> flow -> submit
interface CodeCtx { hash: string; wave_id: string; class_id: string; role: string; grade: number; school_id: string;
  region_id: string; class_size: number | null; roster: Teacher[]; teachers: Teacher[] | null; demo: boolean; open: boolean }

/** Demo codes ("DEMO-<P|S><grade, 2 digits>-<nonce>") run the real questionnaire but nothing is stored. */
function demoCtx(code: string): CodeCtx | null {
  const m = /^DEMO(P|S)(\d{2})([0-9A-Z]{4,})$/.exec(normCode(code));
  if (!m) return null;
  const role = m[1] === 'P' ? 'parent' : 'student';
  const grade = Number(m[2]);
  if (grade < 1 || grade > 12 || (role === 'student' && grade < Q.params.student_min_grade)) return null;
  const roster: Teacher[] = [
    { teacher_id: 'demo-t1', name: 'г-жа Петрова', subject: 'класен ръководител', is_class_teacher: true },
    { teacher_id: 'demo-t2', name: 'г-н Димитров', subject: 'Математика' },
    { teacher_id: 'demo-t3', name: 'г-жа Николова', subject: 'Български език и литература' },
    { teacher_id: 'demo-t4', name: 'г-жа Георгиева', subject: 'Английски език' },
  ];
  return { hash: 'demo-' + m[3], wave_id: 'demo', class_id: 'demo', role, grade, school_id: 'demo', region_id: 'demo',
    class_size: null, roster, teachers: null, demo: true, open: true };
}

async function codeCtx(c: C, code: unknown): Promise<CodeCtx> {
  const demo = demoCtx(String(code ?? ''));
  if (demo) return demo;
  if (normCode(code).length < 8) throw new HttpError(404, 'unknown code');
  const ipHash = await sha256('sf-ip|' + (c.req.header('cf-connecting-ip') || 'unknown') + '|' + new Date().toISOString().slice(0, 10));
  const failKey = `sf-fail:${ipHash}`;
  const fails = Number((await c.env.SESSIONS.get(failKey)) || 0);
  if (fails >= MAX_FAILED_CODES_PER_DAY) throw new HttpError(429, 'Твърде много грешни опити. Опитайте утре.');
  const hash = await codeHash(String(code));
  const row = await c.env.DB.prepare(
    `SELECT k.hash, k.wave_id, k.class_id, k.role, k.used, k.teachers, c.grade, c.school_id, c.region_id, c.class_size, c.roster,
            w.open FROM sf_codes k JOIN sf_classes c ON c.wave_id = k.wave_id AND c.class_id = k.class_id
            JOIN sf_waves w ON w.id = k.wave_id WHERE k.hash = ?`).bind(hash).first<Dict>();
  if (!row) {
    await c.env.SESSIONS.put(failKey, String(fails + 1), { expirationTtl: 86400 });
    throw new HttpError(404, 'unknown code');
  }
  if (row.used) throw new HttpError(409, 'code already used');
  return { hash, wave_id: row.wave_id, class_id: row.class_id, role: row.role, grade: row.grade, school_id: row.school_id,
    region_id: row.region_id, class_size: row.class_size, roster: JSON.parse(row.roster || '[]'),
    teachers: row.teachers ? JSON.parse(row.teachers) : null, demo: false, open: !!row.open };
}

/** Teachers are assigned once per code (least-rated first) and stored, so the form is stable across visits. */
async function teachersFor(c: C, x: CodeCtx): Promise<Teacher[]> {
  if (x.teachers) return x.teachers;
  let counts: Dict<number> = {};
  const ids = x.roster.map((t) => t.teacher_id);
  if (!x.demo && ids.length) {
    const rows = await c.env.DB.prepare(`SELECT teacher_id, n FROM sf_rating_counts WHERE teacher_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids).all<{ teacher_id: string; n: number }>();
    counts = Object.fromEntries(rows.results.map((r) => [r.teacher_id, r.n]));
  }
  const t = assignTeachers(Q, x.hash, x.role, x.roster, counts, x.grade)
    .map(({ teacher_id, name, subject, is_class_teacher }) => ({ teacher_id, name, subject, is_class_teacher }));
  if (!x.demo) await c.env.DB.prepare('UPDATE sf_codes SET teachers = ? WHERE hash = ?').bind(JSON.stringify(t), x.hash).run();
  x.teachers = t;
  return t;
}

async function names(db: D1Database, pairs: [string, string][]): Promise<Dict<string>> {
  const out: Dict<string> = {};
  const uniq = [...new Map(pairs.filter(([, id]) => id).map((p) => [p.join('|'), p])).values()];
  for (let i = 0; i < uniq.length; i += 40) {
    const chunk = uniq.slice(i, i + 40);
    const rows = await db.prepare(`SELECT level, unit_id, name FROM sf_names WHERE ${chunk.map(() => '(level = ? AND unit_id = ?)').join(' OR ')}`)
      .bind(...chunk.flat()).all<{ level: string; unit_id: string; name: string }>();
    for (const r of rows.results) out[`${r.level}|${r.unit_id}`] = r.name;
  }
  return out;
}

const flowCtx = (x: CodeCtx) => ({ role: x.role, grade: x.grade, token: x.hash });

sf.post('/demo-session', async (c) => {
  const b = await body(c);
  const role = b.role === 'student' ? 'S' : 'P';
  const grade = Math.max(1, Math.min(12, Number(b.grade) || 6));
  const nonce = [...crypto.getRandomValues(new Uint8Array(3))].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return c.json({ code: `DEMO-${role}${String(grade).padStart(2, '0')}-${nonce}` });
});

sf.post('/session', async (c) => {
  const b = await body(c);
  const x = await codeCtx(c, b.code);
  if (!x.open) throw new HttpError(410, 'Анкетата за тази вълна е приключила.');
  if (x.role === 'student' && x.grade < Q.params.student_min_grade) throw new HttpError(400, 'Учениците от I–III клас не попълват анкета; попълва родителят.');
  const teachers = await teachersFor(c, x);
  const nm = x.demo ? { 'school|demo': 'Пробно училище' } : await names(c.env.DB, [['school', x.school_id], ['class', x.class_id]]);
  return c.json({
    role: x.role, grade: x.grade, stage: stageOf(Q, x.grade), young_form: isYoung(Q, x.role, x.grade), demo: x.demo,
    school_name: nm[`school|${x.school_id}`] || null, class_name: nm[`class|${x.class_id}`] || null,
    teachers: teachers.map((t) => ({ teacher_id: t.teacher_id, name: t.name, subject: t.subject, is_class_teacher: !!t.is_class_teacher })),
    questions: flow(Q, flowCtx(x), {}, teachers), triggers: TRIGGERS,
  });
});

sf.post('/flow', async (c) => {
  const b = await body(c);
  const x = await codeCtx(c, b.code);
  return c.json({ questions: flow(Q, flowCtx(x), (b.answers || {}) as Answers, await teachersFor(c, x)) });
});

sf.post('/responses', async (c) => {
  const b = await body(c);
  const x = await codeCtx(c, b.code);
  if (!x.open) throw new HttpError(410, 'Анкетата за тази вълна е приключила.');
  const teachers = await teachersFor(c, x);
  const allowed = new Map(teachers.map((t) => [t.teacher_id, t]));
  const tans = Object.entries((b.teacher_answers || {}) as Dict<Answers>)
    .filter(([tid]) => allowed.has(tid)).map(([tid, a]) => ({ teacher_id: tid, name: allowed.get(tid)!.name || '', answers: a }));
  const answers = sanitizeAnswers(b.answers);
  const duration = Number.isFinite(Number(b.duration_s)) ? Math.max(0, Math.round(Number(b.duration_s))) : null;
  const resp: SfResponse = { id: crypto.randomUUID(), token_hash: x.hash, mode: 'closed', role: x.role, grade: x.grade,
    region_id: x.region_id, school_id: x.school_id, class_id: x.class_id, duration_s: duration, answers,
    teachers: tans.map((t) => ({ ...t, answers: sanitizeAnswers(t.answers) })) };
  try { scoreRespondent(Q, resp); } catch { throw new HttpError(400, 'Невалидни отговори.'); }
  if (x.demo) return c.json({ status: 'demo' }, 200);
  // Mark the code used first; the conditional update makes a double submit (two tabs) record only once.
  const upd = await c.env.DB.prepare('UPDATE sf_codes SET used = 1 WHERE hash = ? AND used = 0').bind(x.hash).run();
  if (!upd.meta.changes) throw new HttpError(409, 'code already used');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO sf_responses (id, wave_id, payload, day) VALUES (?, ?, ?, ?)')
      .bind(resp.id, x.wave_id, JSON.stringify(resp), new Date().toISOString().slice(0, 10)),
    ...tans.map((t) => c.env.DB.prepare('INSERT INTO sf_rating_counts (teacher_id, n) VALUES (?, 1) ON CONFLICT(teacher_id) DO UPDATE SET n = n + 1').bind(t.teacher_id)),
  ]);
  return c.json({ status: 'recorded' }, 201);
});

/** Option indices (numbers / arrays of numbers) and free text capped at 2000 characters. Anything else is dropped. */
function sanitizeAnswers(a: unknown): Answers {
  const out: Answers = {};
  if (!a || typeof a !== 'object') return out;
  for (const [k, v] of Object.entries(a as Dict)) {
    if (!/^[A-Z]{2}\d{2}[A-Z_]*$/.test(k)) continue;
    if (Number.isInteger(v) && v >= 0 && v < 50) out[k] = v;
    else if (Array.isArray(v) && v.length <= 20 && v.every((x) => Number.isInteger(x) && x >= 0 && x < 50)) out[k] = [...new Set(v)];
    else if (typeof v === 'string' && v.trim()) out[k] = v.slice(0, 2000);
  }
  return out;
}

// ------------------------------------------------------------------ read: methodology, waves, units
const METHOD_NOTES = [
  'Оценките са 0–100 по всяко измерение; по-високо е по-добре за децата и семействата.',
  'Резултатът на малка единица се „дърпа“ към средното на по-горното ниво (емпиричен Бейс) – толкова повече, колкото по-малко отговори има.',
  'Интервалите са 90%. Категорията сравнява интервала със средното на същото ниво (класове и учители – в рамките на етапа).',
  'Оценките на децата са само контекст: училищата сами оценяват учениците си, затова не са сравними между училища.',
  'Резултатите за учител са поверителни – виждат ги само учителят и директорът.',
  'Връзка не е причина: връзка между натоварване и благополучие не показва кое на какво влияе.',
];

sf.get('/methodology', (c) => c.json({ version: Q.version, dimensions: Q.dimensions, pillars: Q.pillars, params: Q.params, notes: METHOD_NOTES }));

sf.get('/whoami', async (c) => {
  const k = await callerKey(c);
  if (k.scope === 'invalid') throw new HttpError(403, 'Невалиден ключ.');
  const nm = await names(c.env.DB, [['school', k.school_id || ''], ['teacher', k.teacher_id || '']]);
  return c.json({ scope: k.scope, label: k.label ?? null, school_id: k.school_id ?? null, teacher_id: k.teacher_id ?? null,
    school_name: nm[`school|${k.school_id}`] ?? null, teacher_name: nm[`teacher|${k.teacher_id}`] ?? null });
});

async function waves(db: D1Database) {
  const rows = await db.prepare('SELECT id, title, demo, open, created_at, computed_at, meta FROM sf_waves ORDER BY created_at, id').all<Dict>();
  return rows.results.map((w) => ({ id: w.id, title: w.title || w.id, demo: !!w.demo, open: !!w.open, computed: !!w.computed_at, created_at: w.created_at,
    computed_at: w.computed_at, meta: w.meta ? JSON.parse(w.meta) : null }));
}

sf.get('/waves', async (c) => {
  const ws = (await waves(c.env.DB)).filter((w) => w.computed);
  return c.json({ waves: ws.map(({ id, title, demo, computed_at, meta }) => ({ id, title, demo, computed_at, responses: meta?.included ?? null })) });
});

/** Requested wave, else the latest computed real wave, else the latest computed demo wave. */
async function resolveWave(c: C): Promise<Dict> {
  const ws = (await waves(c.env.DB)).filter((w) => w.computed);
  const want = c.req.query('wave');
  const w = want ? ws.find((x) => x.id === want) : (ws.filter((x) => !x.demo).at(-1) || ws.at(-1));
  if (!w) throw new HttpError(404, 'no computed wave');
  return w;
}

async function withNames(db: D1Database, level: string, units: Dict[]): Promise<Dict[]> {
  const pl = ({ class: 'school', school: 'region', region: 'system', teacher: 'school', system: null } as Dict)[level];
  const nm = await names(db, units.flatMap((u) => [[level, u.unit_id], ...(pl ? [[pl, u.parent_id]] : [])]) as [string, string][]);
  return units.map((u) => ({ ...u, name: nm[`${level}|${u.unit_id}`] || (level === 'system' ? 'България' : u.unit_id),
    parent_name: pl ? nm[`${pl}|${u.parent_id}`] || u.parent_id : null }));
}

sf.get('/units', async (c) => {
  const key = await callerKey(c);
  const level = c.req.query('level') || 'school';
  if (!(LEVELS as readonly string[]).includes(level)) throw new HttpError(400, 'bad level');
  const w = await resolveWave(c);
  const rows = await c.env.DB.prepare('SELECT data FROM sf_units WHERE wave_id = ? AND level = ?').bind(w.id, level).all<{ data: string }>();
  const tier = c.req.query('tier');
  let items = rows.results.map((r) => JSON.parse(r.data)).filter((x) => !x.suppressed && canSee(key, level, x)).map((x) => publicView(level, x));
  if (tier) items = items.filter((x) => x.index?.tier_code === tier);
  items.sort((a, b) => (b.index?.score ?? b.dimensions?.TC?.score ?? 0) - (a.index?.score ?? a.dimensions?.TC?.score ?? 0));
  items = await withNames(c.env.DB, level, items);
  return c.json({ wave: w.id, demo: w.demo, level, count: items.length, units: items.map(summary) });
});

async function unitRow(c: C, wave: string, level: string, uid: string, key: Key): Promise<Dict> {
  const r = await c.env.DB.prepare('SELECT data FROM sf_units WHERE wave_id = ? AND level = ? AND unit_id = ?').bind(wave, level, uid).first<{ data: string }>();
  const unit = r ? JSON.parse(r.data) : null;
  if (!unit || unit.suppressed || !canSee(key, level, unit)) throw new HttpError(404, 'not found or not permitted');
  return unit;
}

sf.get('/units/:level/:id', async (c) => {
  const key = await callerKey(c);
  const { level, id } = c.req.param();
  const w = await resolveWave(c);
  const unit = await unitRow(c, w.id, level, id, key);
  const [named] = await withNames(c.env.DB, level, [publicView(level, unit)]);
  const { themes, ...rest } = named;
  return c.json({ wave: w.id, demo: w.demo, ...rest });
});

sf.get('/units/:level/:id/themes', async (c) => {
  const key = await callerKey(c);
  const { level, id } = c.req.param();
  const w = await resolveWave(c);
  const unit = await unitRow(c, w.id, level, id, key);
  const th = unit.themes;
  if (!th || th.respondents_with_text < Q.params.k_anonymity.free_text_min) return c.json({ unit_id: id, themes: {}, note: 'below free-text threshold' });
  return c.json({ wave: w.id, unit_id: id, ...th });
});

sf.get('/units/:level/:id/trend', async (c) => {
  const key = await callerKey(c);
  const { level, id } = c.req.param();
  const ws = new Map((await waves(c.env.DB)).map((w) => [w.id, w]));
  const rows = await c.env.DB.prepare('SELECT wave_id, data FROM sf_units WHERE level = ? AND unit_id = ?').bind(level, id).all<{ wave_id: string; data: string }>();
  const cur = ws.get(c.req.query('wave') || '');
  const out = rows.results
    .map((r) => ({ w: ws.get(r.wave_id), x: JSON.parse(r.data) }))
    .filter(({ w, x }) => w && (!cur || w.demo === cur.demo) && !x.suppressed && !x.publish_blocked && canSee(key, level, x))
    .sort((a, b) => String(a.w!.created_at).localeCompare(String(b.w!.created_at)))
    .map(({ w, x }) => ({ wave: w!.id, title: w!.title, index: x.index,
      dimensions: Object.fromEntries(Object.entries(x.dimensions || {}).map(([d, v]: [string, any]) => [d, v.score])) }));
  return c.json({ unit_id: id, trend: out });
});

sf.get('/compare', async (c) => {
  const key = await callerKey(c);
  const level = c.req.query('level') || 'school';
  const a = c.req.query('a') || '', b = c.req.query('b') || '';
  const w = await resolveWave(c);
  const ua = await unitRow(c, w.id, level, a, key);
  const ub = b && b !== 'reference' ? await unitRow(c, w.id, level, b, key) : null;
  const ref = ub || JSON.parse((await c.env.DB.prepare('SELECT data FROM sf_units WHERE wave_id = ? AND level = ? AND unit_id = ?')
    .bind(w.id, 'system', 'BG').first<{ data: string }>())?.data || 'null');
  const rows = Object.entries(ua.dimensions || {}).flatMap(([d, va]: [string, any]) => {
    const vb = ref?.dimensions?.[d];
    if (!vb) return [];
    return [{ dimension: d, name: Q.dimensions[d].name, a: va.score, b: vb.score, diff: Math.round((va.score - vb.score) * 10) / 10,
      clear_difference: va.lo > vb.hi || va.hi < vb.lo }];
  });
  return c.json({ a: ua.unit_id, b: ub?.unit_id ?? 'system', rows, index: { a: ua.index, b: ref?.index ?? null } });
});

// ------------------------------------------------------------------ admin
async function requireAdmin(c: C) {
  if ((await callerKey(c)).scope !== 'admin') {
    throw new HttpError(403, c.env.SF_ADMIN_KEY ? 'Нужен е администраторски ключ.' : 'Администрирането не е настроено: задайте SF_ADMIN_KEY (wrangler secret put SF_ADMIN_KEY).');
  }
}

const ID = /^[\p{L}\p{N}_.-]{1,64}$/u;
function id(v: unknown, what: string): string {
  const s = String(v ?? '').trim();
  if (!ID.test(s)) throw new HttpError(400, `Невалиден идентификатор: ${what}`);
  return s;
}

sf.get('/admin/waves', async (c) => {
  await requireAdmin(c);
  const ws = await waves(c.env.DB);
  const counts = await c.env.DB.prepare(`SELECT wave_id, COUNT(*) AS n FROM sf_responses GROUP BY wave_id`).all<{ wave_id: string; n: number }>();
  const codes = await c.env.DB.prepare(`SELECT wave_id, COUNT(*) AS n, SUM(used) AS used FROM sf_codes GROUP BY wave_id`).all<Dict>();
  const classes = await c.env.DB.prepare(`SELECT wave_id, COUNT(*) AS n FROM sf_classes GROUP BY wave_id`).all<Dict>();
  const by = (rs: Dict[]) => Object.fromEntries(rs.map((r) => [r.wave_id, r]));
  const rc = by(counts.results), cc = by(codes.results), cl = by(classes.results);
  return c.json({ waves: ws.map((w) => ({ ...w, responses: rc[w.id]?.n || 0, codes: cc[w.id]?.n || 0, used: cc[w.id]?.used || 0, classes: cl[w.id]?.n || 0 })) });
});

sf.post('/admin/waves', async (c) => {
  await requireAdmin(c);
  const b = await body(c);
  const wid = id(b.id, 'вълна');
  await c.env.DB.prepare('INSERT INTO sf_waves (id, title) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title')
    .bind(wid, String(b.title || wid).slice(0, 100)).run();
  return c.json({ id: wid }, 201);
});

sf.post('/admin/waves/:id/open', async (c) => {
  await requireAdmin(c);
  const b = await body(c);
  await c.env.DB.prepare('UPDATE sf_waves SET open = ? WHERE id = ?').bind(b.open ? 1 : 0, c.req.param('id')).run();
  return c.json({ id: c.req.param('id'), open: !!b.open });
});

sf.delete('/admin/waves/:id', async (c) => {
  await requireAdmin(c);
  const wid = c.req.param('id');
  await c.env.DB.batch(['sf_units', 'sf_responses', 'sf_codes', 'sf_classes'].map((t) => c.env.DB.prepare(`DELETE FROM ${t} WHERE wave_id = ?`).bind(wid))
    .concat(c.env.DB.prepare('DELETE FROM sf_waves WHERE id = ?').bind(wid)));
  return c.json({ deleted: wid });
});

/** Register a class in a wave and issue one code per parent and per student. Plain codes are returned ONCE. */
sf.post('/admin/classes', async (c) => {
  await requireAdmin(c);
  const b = await body(c);
  const wave = id(b.wave, 'вълна'), classId = id(b.class_id, 'клас'), schoolId = id(b.school_id, 'училище'), regionId = id(b.region_id, 'регион');
  const grade = Number(b.grade);
  if (!(grade >= 1 && grade <= 12)) throw new HttpError(400, 'Класът трябва да е от 1 до 12.');
  const w = await c.env.DB.prepare('SELECT id FROM sf_waves WHERE id = ?').bind(wave).first();
  if (!w) throw new HttpError(404, 'Няма такава вълна.');
  const roster: Teacher[] = (Array.isArray(b.roster) ? b.roster : []).slice(0, 40).map((t: Dict, i: number) => ({
    teacher_id: id(t.teacher_id || `${schoolId}-T${i + 1}`, 'учител'), name: String(t.name || '').slice(0, 80),
    subject: String(t.subject || '').slice(0, 80), is_class_teacher: !!t.is_class_teacher }));
  if (roster.filter((t) => t.is_class_teacher).length > 1) throw new HttpError(400, 'Само един класен ръководител.');
  const classSize = Math.max(0, Math.min(60, Number(b.class_size) || 0)) || null;
  const nParent = Math.max(0, Math.min(80, Number(b.n_parent) || 0));
  const nStudent = grade < Q.params.student_min_grade ? 0 : Math.max(0, Math.min(80, Number(b.n_student) || 0));
  const out: Dict<string[]> = { parent: [], student: [] };
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`INSERT INTO sf_classes (wave_id, class_id, school_id, region_id, grade, class_size, roster) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(wave_id, class_id) DO UPDATE SET school_id = excluded.school_id, region_id = excluded.region_id, grade = excluded.grade,
      class_size = excluded.class_size, roster = excluded.roster`).bind(wave, classId, schoolId, regionId, grade, classSize, JSON.stringify(roster)),
  ];
  const nameRows: [string, string, unknown][] = [['region', regionId, b.region_name], ['school', schoolId, b.school_name], ['class', classId, b.class_name],
    ...roster.map((t) => ['teacher', t.teacher_id, t.name] as [string, string, unknown])];
  for (const [lv, uid, name] of nameRows) {
    if (name) stmts.push(c.env.DB.prepare('INSERT INTO sf_names (level, unit_id, name) VALUES (?, ?, ?) ON CONFLICT(level, unit_id) DO UPDATE SET name = excluded.name')
      .bind(lv, uid, String(name).slice(0, 120)));
  }
  for (const [role, n] of [['parent', nParent], ['student', nStudent]] as const) {
    for (let i = 0; i < n; i++) {
      const code = newCode();
      out[role].push(code);
      stmts.push(c.env.DB.prepare('INSERT INTO sf_codes (hash, wave_id, class_id, role) VALUES (?, ?, ?, ?)').bind(await codeHash(code), wave, classId, role));
    }
  }
  await c.env.DB.batch(stmts);
  return c.json({ wave, class_id: classId, grade, codes: out }, 201);
});

sf.post('/admin/keys', async (c) => {
  await requireAdmin(c);
  const b = await body(c);
  const scope = String(b.scope);
  if (!['researcher', 'school_admin', 'teacher', 'admin'].includes(scope)) throw new HttpError(400, 'Невалиден обхват.');
  if (scope === 'school_admin' && !b.school_id) throw new HttpError(400, 'Нужно е училище.');
  if (scope === 'teacher' && !b.teacher_id) throw new HttpError(400, 'Нужен е учител.');
  const key = newKey();
  await c.env.DB.prepare('INSERT INTO sf_keys (hash, scope, school_id, teacher_id, label) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256('sf-key|' + key), scope, b.school_id || null, b.teacher_id || null, String(b.label || '').slice(0, 100) || null).run();
  return c.json({ key, scope }, 201);
});

sf.get('/admin/keys', async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare('SELECT substr(hash, 1, 12) AS id, scope, school_id, teacher_id, label, created_at FROM sf_keys ORDER BY created_at DESC').all();
  return c.json({ keys: rows.results });
});

sf.delete('/admin/keys/:id', async (c) => {
  await requireAdmin(c);
  await c.env.DB.prepare('DELETE FROM sf_keys WHERE substr(hash, 1, 12) = ?').bind(c.req.param('id')).run();
  return c.json({ deleted: c.req.param('id') });
});

function bootstrapReps(env: SfEnv, fallback = 400): number {
  const n = parseInt(env.SF_BOOTSTRAP_REPS || '', 10);
  return Number.isFinite(n) && n >= 50 ? Math.min(n, 1000) : fallback;
}

/** Store one computed wave: unit rows (+ redacted text themes) and the wave meta. */
async function storeWave(db: D1Database, waveId: string, res: Dict, responses: SfResponse[]) {
  const by: Dict<Map<string, SfResponse[]>> = { school: new Map(), region: new Map(), system: new Map() };
  const add = (lv: string, u: string, r: SfResponse) => { if (!by[lv].has(u)) by[lv].set(u, []); by[lv].get(u)!.push(r); };
  for (const r of responses) { add('school', r.school_id, r); add('region', r.region_id, r); add('system', 'BG', r); }
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM sf_units WHERE wave_id = ?').bind(waveId)];
  for (const level of LEVELS) {
    for (const [uid, unit] of Object.entries(res[level] as Dict<Dict>)) {
      const rs = by[level]?.get(uid);
      const data = rs ? { ...unit, themes: themesFor(rs) } : unit;
      stmts.push(db.prepare('INSERT INTO sf_units (wave_id, level, unit_id, parent_id, data) VALUES (?, ?, ?, ?, ?)')
        .bind(waveId, level, uid, unit.parent_id ?? null, JSON.stringify(data)));
    }
  }
  stmts.push(db.prepare(`UPDATE sf_waves SET computed_at = datetime('now'), meta = ? WHERE id = ?`)
    .bind(JSON.stringify({ ...res.meta, campaign_alerts: res.campaign_alerts }), waveId));
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
}

sf.post('/admin/waves/:id/compute', async (c) => {
  await requireAdmin(c);
  const wid = c.req.param('id');
  const rows = await c.env.DB.prepare('SELECT payload FROM sf_responses WHERE wave_id = ?').bind(wid).all<{ payload: string }>();
  const responses = rows.results.map((r) => JSON.parse(r.payload) as SfResponse);
  if (!responses.length) throw new HttpError(400, 'Няма отговори за тази вълна.');
  const sizes = await c.env.DB.prepare('SELECT class_id, class_size FROM sf_classes WHERE wave_id = ? AND class_size > 0').bind(wid).all<Dict>();
  const q = structuredClone(Q);
  q.params.bootstrap_reps = bootstrapReps(c.env);
  const classSizes = Object.fromEntries(sizes.results.map((r) => [r.class_id, r.class_size]));
  const res = runWave(q, responses, { classSizes: Object.keys(classSizes).length ? classSizes : null });
  await storeWave(c.env.DB, wid, res, responses);
  return c.json({ wave: wid, meta: res.meta, campaign_alerts: res.campaign_alerts });
});

const DEMO_REGIONS = ['Северозападен', 'Южен централен', 'Югоизточен'];

/** Two simulated waves for trying the portal before real data exists. Clearly marked as demo; raw answers are not kept. */
sf.post('/admin/demo', async (c) => {
  await requireAdmin(c);
  const q = structuredClone(Q);
  q.params.bootstrap_reps = Math.min(200, bootstrapReps(c.env, 200));
  const defs = [['demo-2026-spring', 'Демо · пролет 2026', 7, false], ['demo-2026-autumn', 'Демо · есен 2026', 8, true]] as const;
  for (const [wid, title, seed, campaign] of defs) {
    const s = simulate(q, { regions: 3, schoolsPerRegion: 5, seed, campaignClass: campaign });
    const res = runWave(q, s.responses, { classSizes: s.truth.class_sizes });
    await c.env.DB.prepare(`INSERT INTO sf_waves (id, title, demo, open, created_at) VALUES (?, ?, 1, 0, datetime('now', ?))
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, demo = 1, open = 0`).bind(wid, title, seed === 7 ? '-1 minute' : '+0 minute').run();
    await storeWave(c.env.DB, wid, res, s.responses);
    const nameStmts: D1PreparedStatement[] = [];
    const put = (lv: string, uid: string, name: string) => nameStmts.push(
      c.env.DB.prepare('INSERT INTO sf_names (level, unit_id, name) VALUES (?, ?, ?) ON CONFLICT(level, unit_id) DO NOTHING').bind(lv, uid, name));
    DEMO_REGIONS.forEach((r, i) => put('region', `R${i + 1}`, `${r} (демо)`));
    for (const sid of Object.keys(res.school)) put('school', sid, `Демо училище ${sid.replace(/^R(\d+)-S(\d+)$/, '$1.$2')}`);
    for (const [cid, g] of Object.entries(s.classGrades)) put('class', cid, `${g} клас`);
    for (const tid of Object.keys(res.teacher)) put('teacher', tid, `Учител ${tid.split('-T')[1]} (демо)`);
    for (let i = 0; i < nameStmts.length; i += 80) await c.env.DB.batch(nameStmts.slice(i, i + 80));
  }
  return c.json({ waves: defs.map(([w]) => w) });
});
