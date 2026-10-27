/**
 * School feedback platform API, mounted at /api/sf (port of school-feedback/api.py onto D1).
 *
 * Design rules
 * - Respondents never authenticate as persons. A one-time anonymous code fixes wave, school, class, grade and
 *   role; only its SHA-256 hash is stored, and it is marked used on submit.
 * - Read endpoints return only aggregates, already filtered by k-anonymity and further by the caller's scope
 *   (Authorization: Bearer <key>):
 *     public        system, region, school
 *     researcher    + class (no teacher level)
 *     school_admin  + class and teacher units of ONE school
 *     teacher       ONLY own teacher unit
 *     inspector     + class and teacher units of ONE region (or all, without region) and their signals (РУО)
 *     admin         everything + waves, classes, codes, keys, compute (SF_ADMIN_KEY secret or an admin key)
 * - Signals (units clearly above the national rate of a harmful practice or of distress) are stored apart from
 *   the results and are read only by the inspectorate, the school concerned and the teacher concerned.
 * - No names, e-mails, phones or IP addresses are stored. Failed code attempts are counted per hashed IP and
 *   day (sf_attempts) to stop guessing. Free text is redacted and reduced to themes when it is submitted.
 *
 * Fits the Workers free plan (10 ms CPU per request): no request computes a wave. The operator console exports
 * the wave's numeric answers page by page, runs the same engine in the browser (frontend/school/lib/sf-engine.js)
 * and uploads ready-made unit rows; list endpoints are a single SQL query whose JSON is assembled from stored
 * strings, never parsed.
 */
import { Hono, type Context } from 'hono';
import {
  assignTeachers, flow, isYoung, loadQuestionnaire, scoreRespondent, stageOf,
  type Answers, type Response as SfResponse, type Teacher,
} from './engine';

export interface SfEnv {
  DB: D1Database;
  SF_ADMIN_KEY?: string;
  /** hex SHA-256 of the operator key; safe to keep as a public var in wrangler.jsonc */
  SF_ADMIN_KEY_SHA256?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dict<T = any> = Record<string, T>;
type C = Context<{ Bindings: SfEnv }>;

const Q = loadQuestionnaire();
const LEVELS = ['system', 'region', 'school', 'class', 'teacher'] as const;
const MAX_FAILED_CODES_PER_DAY = 30;
const MAX_OPEN_SESSIONS_PER_DAY = 10;   // per network address; open answers count half and never confirm a signal alone
const MAX_SCHOOL_REQUESTS_PER_DAY = 5;
const MAX_BAD_KEYS_PER_DAY = 30;
const POW_BITS = 15;                    // ~33k SHA-256 on average: under a second in a browser, costly at scale
const POW_TTL_MS = 15 * 60 * 1000;

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
  // payload: numeric answers only (engine input); themes: JSON array from the redacted free text; texts: redacted
  // free text, kept on the server for a human review of themes and never exported
  `CREATE TABLE IF NOT EXISTS sf_responses (id TEXT PRIMARY KEY, wave_id TEXT NOT NULL, payload TEXT NOT NULL, themes TEXT, texts TEXT, day TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sf_responses_wave ON sf_responses (wave_id)`,
  `CREATE TABLE IF NOT EXISTS sf_units (wave_id TEXT NOT NULL, level TEXT NOT NULL, unit_id TEXT NOT NULL, parent_id TEXT,
     suppressed INTEGER NOT NULL DEFAULT 0, score REAL, tier TEXT, summary TEXT NOT NULL, data TEXT NOT NULL,
     PRIMARY KEY (wave_id, level, unit_id))`,
  `CREATE TABLE IF NOT EXISTS sf_attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sf_units_unit ON sf_units (level, unit_id)`,
  `CREATE TABLE IF NOT EXISTS sf_rating_counts (teacher_id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)`,
  // schools anyone can fill in for without a code: imported from the official register or proposed and approved
  `CREATE TABLE IF NOT EXISTS sf_schools (school_id TEXT PRIMARY KEY, name TEXT NOT NULL, town TEXT, region_id TEXT, region_name TEXT,
     source TEXT, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sf_school_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, town TEXT, region_name TEXT, role TEXT, note TEXT,
     status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sf_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sf_keys (hash TEXT PRIMARY KEY, scope TEXT NOT NULL, school_id TEXT, teacher_id TEXT, label TEXT,
     created_at TEXT DEFAULT (datetime('now')))`,
];
// Columns added after the first release; ALTER fails harmlessly ("duplicate column") once they exist.
const MIGRATIONS = [
  'ALTER TABLE sf_units ADD COLUMN region_id TEXT',
  'ALTER TABLE sf_units ADD COLUMN n_signals INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE sf_units ADD COLUMN signals TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE sf_keys ADD COLUMN region_id TEXT',
  "ALTER TABLE sf_codes ADD COLUMN mode TEXT NOT NULL DEFAULT 'closed'",
];
let schemaReady: Promise<unknown> | null = null;
function ensureSchema(db: D1Database) {
  schemaReady ??= (async () => {
    await db.batch(SCHEMA.map((s) => db.prepare(s)));
    for (const m of MIGRATIONS) {
      try { await db.prepare(m).run(); } catch (e) { if (!/duplicate column/i.test(String(e))) throw e; }
    }
  })().catch((e) => { schemaReady = null; throw e; });
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

interface Key { scope: string; school_id?: string | null; teacher_id?: string | null; region_id?: string | null; label?: string | null }

async function callerKey(c: C): Promise<Key> {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header('Authorization') || '');
  if (!m) return { scope: 'public' };
  const token = m[1].trim();
  const badKey = 'key|' + (await ipKey(c));
  const bad = await c.env.DB.prepare('SELECT n FROM sf_attempts WHERE key = ?').bind(badKey).first<{ n: number }>();
  if ((bad?.n || 0) >= MAX_BAD_KEYS_PER_DAY) throw new HttpError(429, 'Твърде много грешни ключове от тази връзка. Опитайте утре.');
  if (c.env.SF_ADMIN_KEY && safeEqual(token, c.env.SF_ADMIN_KEY)) return { scope: 'admin', label: 'оператор' };
  if (c.env.SF_ADMIN_KEY_SHA256 && safeEqual(await sha256(token), c.env.SF_ADMIN_KEY_SHA256.toLowerCase())) return { scope: 'admin', label: 'оператор' };
  const row = await c.env.DB.prepare('SELECT scope, school_id, teacher_id, region_id, label FROM sf_keys WHERE hash = ?')
    .bind(await sha256('sf-key|' + token)).first<Key>();
  if (!row) await bump(c, badKey);
  return row || { scope: 'invalid' };
}

// =============================================================================== scope filtering
function canSee(key: Key, level: string, unit: Dict, region?: string | null): boolean {
  const sc = key.scope;
  if (sc === 'admin') return true;
  if (sc === 'teacher') return level === 'teacher' && unit.unit_id === key.teacher_id;
  if (level === 'system' || level === 'region' || level === 'school') return true;
  if (sc === 'researcher') return level === 'class';
  if (sc === 'school_admin') return (level === 'class' || level === 'teacher') && unit.parent_id === key.school_id;
  if (sc === 'inspector') return (level === 'class' || level === 'teacher') && (!key.region_id || region === key.region_id);
  return false;
}

/** Signals: the inspectorate (its region), the school concerned (itself, its classes and teachers), the teacher concerned. */
function canSeeSignals(key: Key, level: string, unit: Dict, region?: string | null): boolean {
  const sc = key.scope;
  if (sc === 'admin') return true;
  if (sc === 'inspector') return !key.region_id || region === key.region_id || (level === 'region' && unit.unit_id === key.region_id);
  if (sc === 'school_admin') return (level === 'school' && unit.unit_id === key.school_id) || ((level === 'class' || level === 'teacher') && unit.parent_id === key.school_id);
  if (sc === 'teacher') return level === 'teacher' && unit.unit_id === key.teacher_id;
  return false;
}

function signalsScopeSql(key: Key): { sql: string; args: unknown[] } | null {
  const sc = key.scope;
  if (sc === 'admin') return { sql: '', args: [] };
  if (sc === 'inspector') return key.region_id ? { sql: ' AND u.region_id = ?', args: [key.region_id] } : { sql: '', args: [] };
  if (sc === 'school_admin') return { sql: " AND ((u.level = 'school' AND u.unit_id = ?) OR (u.level IN ('class', 'teacher') AND u.parent_id = ?))", args: [key.school_id, key.school_id] };
  if (sc === 'teacher') return { sql: " AND u.level = 'teacher' AND u.unit_id = ?", args: [key.teacher_id] };
  return null;
}

/** What leaves the server: blocked units are withheld. */
function publicView(level: string, unit: Dict): Dict {
  if (unit.publish_blocked) return { unit_id: unit.unit_id, level, withheld: unit.publish_blocked };
  return unit;
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

/** Redacted free text and the themes it mentions; computed once, when the response is submitted. */
function textThemes(answers: Answers): { texts: Dict<string>; themes: string[] } | null {
  const texts: Dict<string> = {};
  for (const k of ['OT01', 'OT02', 'OT03']) {
    const v = answers[k];
    if (typeof v === 'string' && v.trim()) texts[k] = redact(v);
  }
  if (!Object.keys(texts).length) return null;
  const low = Object.values(texts).join(' ').toLowerCase();
  return { texts, themes: Object.entries(THEMES).filter(([, stems]) => stems.some((st) => low.includes(st))).map(([t]) => t) };
}

// =============================================================================== app
export const sf = new Hono<{ Bindings: SfEnv }>();

sf.use('*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
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

async function body(c: C, limit = 256 * 1024): Promise<Dict> {
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > limit) throw new HttpError(400, 'Заявката е твърде голяма.');
  try { return (await c.req.json()) || {}; } catch { throw new HttpError(400, 'Невалиден JSON.'); }
}

// ------------------------------------------------------------------ respondent: code -> session -> flow -> submit
interface CodeCtx { hash: string; wave_id: string; class_id: string; role: string; grade: number; school_id: string;
  region_id: string; class_size: number | null; roster: Teacher[]; teachers: Teacher[] | null; demo: boolean; open: boolean;
  mode: 'closed' | 'open' }

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
    class_size: null, roster, teachers: null, demo: true, open: true, mode: 'closed' };
}

async function codeCtx(c: C, code: unknown): Promise<CodeCtx> {
  const demo = demoCtx(String(code ?? ''));
  if (demo) return demo;
  if (normCode(code).length < 8) throw new HttpError(404, 'unknown code');
  const ipHash = await ipKey(c);
  const att = await c.env.DB.prepare('SELECT n FROM sf_attempts WHERE key = ?').bind(ipHash).first<{ n: number }>();
  if ((att?.n || 0) >= MAX_FAILED_CODES_PER_DAY) throw new HttpError(429, 'Твърде много грешни опити. Опитайте утре.');
  const hash = await codeHash(String(code));
  const row = await c.env.DB.prepare(
    `SELECT k.hash, k.wave_id, k.class_id, k.role, k.used, k.teachers, k.mode, c.grade, c.school_id, c.region_id, c.class_size, c.roster,
            w.open FROM sf_codes k JOIN sf_classes c ON c.wave_id = k.wave_id AND c.class_id = k.class_id
            JOIN sf_waves w ON w.id = k.wave_id WHERE k.hash = ?`).bind(hash).first<Dict>();
  if (!row) {
    const day = new Date().toISOString().slice(0, 10);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO sf_attempts (key, n, day) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1').bind(ipHash, day),
      c.env.DB.prepare('DELETE FROM sf_attempts WHERE day < ?').bind(day),   // yesterday's counters are useless
    ]);
    throw new HttpError(404, 'unknown code');
  }
  if (row.used) throw new HttpError(409, 'code already used');
  return { hash, wave_id: row.wave_id, class_id: row.class_id, role: row.role, grade: row.grade, school_id: row.school_id,
    region_id: row.region_id, class_size: row.class_size, roster: JSON.parse(row.roster || '[]'),
    teachers: row.teachers ? JSON.parse(row.teachers) : null, demo: false, open: !!row.open, mode: row.mode === 'open' ? 'open' : 'closed' };
}

const ipKey = (c: C) => sha256('sf-ip|' + (c.req.header('cf-connecting-ip') || 'unknown') + '|' + new Date().toISOString().slice(0, 10));

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

// ------------------------------------------------------------------ open mode: no code, the respondent picks the school
// Answers without a code cannot be tied to a class list, so the engine counts them at half weight ("unverified").
// They go to one class per grade of the school; there are no teacher ratings without a code.

async function bump(c: C, key: string) {
  const day = new Date().toISOString().slice(0, 10);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO sf_attempts (key, n, day) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1').bind(key, day),
    c.env.DB.prepare('DELETE FROM sf_attempts WHERE day < ?').bind(day),
  ]);
}

async function underLimit(c: C, prefix: string, max: number, msg: string): Promise<string> {
  const key = prefix + '|' + (await ipKey(c));
  const att = await c.env.DB.prepare('SELECT n FROM sf_attempts WHERE key = ?').bind(key).first<{ n: number }>();
  if ((att?.n || 0) >= max) throw new HttpError(429, msg);
  return key;
}

// ------------------------------------------------------------------ proof of work (no captcha, no third party)
// The browser finds a nonce so that SHA-256(challenge:nonce) starts with POW_BITS zero bits. Challenges are signed
// with a secret kept in D1, expire after 15 minutes and are accepted once.
async function powSecret(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT v FROM sf_meta WHERE k = 'pow'").first<{ v: string }>();
  if (row) return row.v;
  const v = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT OR IGNORE INTO sf_meta (k, v) VALUES ('pow', ?)").bind(v).run();
  return (await db.prepare("SELECT v FROM sf_meta WHERE k = 'pow'").first<{ v: string }>())!.v;
}

function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v === 0) { bits += 4; continue; }
    return bits + Math.clz32(v) - 28;
  }
  return bits;
}

sf.get('/pow', async (c) => {
  const body = `${Date.now()}.${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  const sig = (await sha256(`${await powSecret(c.env.DB)}|${body}`)).slice(0, 20);
  return c.json({ challenge: `${body}.${sig}`, bits: POW_BITS });
});

async function verifyPow(c: C, pow: unknown) {
  const p = (pow || {}) as Dict;
  const ch = String(p.challenge || ''), nonce = String(p.nonce ?? '');
  const m = /^(\d{13})\.([0-9a-f]{16})\.([0-9a-f]{20})$/.exec(ch);
  const fail = () => new HttpError(400, 'Проверката не мина. Презаредете страницата и опитайте отново.');
  if (!m || !/^\d{1,12}$/.test(nonce)) throw fail();
  if (Date.now() - Number(m[1]) > POW_TTL_MS) throw fail();
  if ((await sha256(`${await powSecret(c.env.DB)}|${m[1]}.${m[2]}`)).slice(0, 20) !== m[3]) throw fail();
  if (leadingZeroBits(await sha256(`${ch}:${nonce}`)) < POW_BITS) throw fail();
  try {   // once only
    await c.env.DB.prepare('INSERT INTO sf_attempts (key, n, day) VALUES (?, 1, ?)').bind('pow|' + m[2], new Date().toISOString().slice(0, 10)).run();
  } catch { throw fail(); }
}

// ------------------------------------------------------------------ open mode: no code, the respondent picks the school
// Answers without a code cannot be tied to a class list, so the engine counts them at half weight ("unverified") and
// they never confirm a signal on their own. They go to one class per grade of the school; no teacher ratings.

const latestOpenWave = (db: D1Database) =>
  db.prepare('SELECT id FROM sf_waves WHERE open = 1 AND demo = 0 ORDER BY created_at DESC LIMIT 1').first<{ id: string }>();

/** Where a school's open answers go: the wave its registered classes are in, else the latest open wave (register schools). */
async function openHome(db: D1Database, schoolId: string): Promise<{ wave_id: string; region_id: string; name: string; region: string | null } | null> {
  const cls = await db.prepare(
    `SELECT c.wave_id, c.region_id, n.name, r.name AS region FROM sf_classes c JOIN sf_waves w ON w.id = c.wave_id
       LEFT JOIN sf_names n ON n.level = 'school' AND n.unit_id = c.school_id LEFT JOIN sf_names r ON r.level = 'region' AND r.unit_id = c.region_id
     WHERE c.school_id = ? AND w.open = 1 AND w.demo = 0 ORDER BY w.created_at DESC LIMIT 1`).bind(schoolId).first<Dict>();
  if (cls) return { wave_id: cls.wave_id, region_id: cls.region_id, name: cls.name || schoolId, region: cls.region };
  const reg = await db.prepare('SELECT name, town, region_id, region_name FROM sf_schools WHERE school_id = ?').bind(schoolId).first<Dict>();
  const w = reg && (await latestOpenWave(db));
  if (!reg || !w) return null;
  return { wave_id: w.id, region_id: reg.region_id || 'неуточнен', name: reg.name, region: reg.region_name || reg.town || null };
}

/** Schools that can be filled in for without a code, for the search box. */
sf.get('/schools', async (c) => {
  const q = String(c.req.query('q') || '').trim().toLowerCase().replace(/[%_]/g, '').slice(0, 60);
  if (q.length < 2) return c.json({ schools: [] });
  // SQLite LIKE ignores case only for Latin letters: try "софия", "София" and "СОФИЯ"
  const pats = [...new Set([q, q[0].toUpperCase() + q.slice(1), q.toUpperCase()])].map((v) => `%${v}%`);
  const like = (cols: string[]) => cols.flatMap((col) => pats.map(() => `${col} LIKE ?`)).join(' OR ');
  const [cls, reg, w] = await Promise.all([
    c.env.DB.prepare(
      `SELECT DISTINCT c.school_id, n.name AS name, r.name AS region FROM sf_classes c JOIN sf_waves w ON w.id = c.wave_id
         JOIN sf_names n ON n.level = 'school' AND n.unit_id = c.school_id
         LEFT JOIN sf_names r ON r.level = 'region' AND r.unit_id = c.region_id
       WHERE w.open = 1 AND w.demo = 0 AND (${like(['n.name', 'r.name'])}) ORDER BY n.name LIMIT 20`).bind(...pats, ...pats).all<Dict>(),
    c.env.DB.prepare(`SELECT school_id, name, coalesce(town, region_name) AS region FROM sf_schools
       WHERE ${like(['name', 'town', 'region_name'])} ORDER BY name LIMIT 20`).bind(...pats, ...pats, ...pats).all<Dict>(),
    latestOpenWave(c.env.DB),
  ]);
  const out = new Map<string, Dict>();
  for (const r of cls.results) out.set(r.school_id, r);
  if (w) for (const r of reg.results) if (!out.has(r.school_id)) out.set(r.school_id, r);
  return c.json({ schools: [...out.values()].slice(0, 20) });
});

/** One school, for its own survey link and QR code (survey.html?s=<id>). */
sf.get('/schools/:id', async (c) => {
  const home = await openHome(c.env.DB, id(c.req.param('id'), 'училище'));
  if (!home) throw new HttpError(404, 'Това училище в момента не събира отговори.');
  return c.json({ school_id: c.req.param('id'), name: home.name, region: home.region });
});

sf.post('/open-session', async (c) => {
  const b = await body(c);
  const schoolId = id(b.school_id, 'училище');
  const role = b.role === 'student' ? 'student' : 'parent';
  const grade = Number(b.grade);
  if (!(grade >= 1 && grade <= 12)) throw new HttpError(400, 'Изберете клас от 1 до 12.');
  if (role === 'student' && grade < Q.params.student_min_grade) throw new HttpError(400, 'Учениците от I–III клас не попълват анкета; попълва родителят.');
  const home = await openHome(c.env.DB, schoolId);
  if (!home) throw new HttpError(404, 'Това училище в момента не събира отговори.');
  const key = await underLimit(c, 'open', MAX_OPEN_SESSIONS_PER_DAY, 'От тази връзка днес са попълнени много анкети. Опитайте утре.');
  await verifyPow(c, b.pow);
  const classId = `${schoolId}-g${grade}`, code = newCode();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO sf_classes (wave_id, class_id, school_id, region_id, grade, class_size, roster)
      VALUES (?, ?, ?, ?, ?, NULL, '[]')`).bind(home.wave_id, classId, schoolId, home.region_id, grade),
    c.env.DB.prepare('INSERT OR IGNORE INTO sf_names (level, unit_id, name) VALUES (?, ?, ?)').bind('class', classId, `${grade} клас`),
    c.env.DB.prepare('INSERT OR IGNORE INTO sf_names (level, unit_id, name) VALUES (?, ?, ?)').bind('school', schoolId, home.name),
    ...(home.region ? [c.env.DB.prepare('INSERT OR IGNORE INTO sf_names (level, unit_id, name) VALUES (?, ?, ?)').bind('region', home.region_id, home.region)] : []),
    c.env.DB.prepare("INSERT INTO sf_codes (hash, wave_id, class_id, role, mode) VALUES (?, ?, ?, ?, 'open')")
      .bind(await codeHash(code), home.wave_id, classId, role),
  ]);
  await bump(c, key);
  return c.json({ code });
});

/** Anyone may propose a missing school; it becomes available once the operator approves it. */
sf.post('/school-requests', async (c) => {
  const b = await body(c, 8 * 1024);
  const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const name = clean(b.name, 160), town = clean(b.town, 80);
  if (name.length < 4 || town.length < 2) throw new HttpError(400, 'Напишете името на училището и населеното място.');
  const key = await underLimit(c, 'req', MAX_SCHOOL_REQUESTS_PER_DAY, 'Днес от тази връзка са изпратени много предложения. Опитайте утре.');
  await verifyPow(c, b.pow);
  await c.env.DB.prepare('INSERT INTO sf_school_requests (id, name, town, region_name, role, note) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), name, town, clean(b.region_name, 80) || null, ['parent', 'student', 'teacher', 'director'].includes(b.role) ? b.role : null,
      clean(b.note, 500) || null).run();
  await bump(c, key);
  return c.json({ status: 'received' }, 201);
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
  const all = sanitizeAnswers(b.answers);
  const tt = textThemes(all);
  const answers = Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v !== 'string')) as Answers;
  const duration = Number.isFinite(Number(b.duration_s)) ? Math.max(0, Math.round(Number(b.duration_s))) : null;
  const resp: SfResponse = { id: crypto.randomUUID(), token_hash: x.hash, mode: x.mode, role: x.role, grade: x.grade,
    region_id: x.region_id, school_id: x.school_id, class_id: x.class_id, duration_s: duration, answers,
    teachers: tans.map((t) => ({ ...t, answers: sanitizeAnswers(t.answers) })) };
  try { scoreRespondent(Q, resp); } catch { throw new HttpError(400, 'Невалидни отговори.'); }
  if (x.demo) return c.json({ status: 'demo' }, 200);
  // Mark the code used first; the conditional update makes a double submit (two tabs) record only once.
  const upd = await c.env.DB.prepare('UPDATE sf_codes SET used = 1 WHERE hash = ? AND used = 0').bind(x.hash).run();
  if (!upd.meta.changes) throw new HttpError(409, 'code already used');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO sf_responses (id, wave_id, payload, themes, texts, day) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(resp.id, x.wave_id, JSON.stringify(resp), tt ? JSON.stringify(tt.themes) : null, tt ? JSON.stringify(tt.texts) : null,
        new Date().toISOString().slice(0, 10)),
    ...tans.map((t) => c.env.DB.prepare('INSERT INTO sf_rating_counts (teacher_id, n) VALUES (?, 1) ON CONFLICT(teacher_id) DO UPDATE SET n = n + 1').bind(t.teacher_id)),
    // retention promised in the privacy notice: free text 12 months, raw answers 3 years (published aggregates stay)
    c.env.DB.prepare("UPDATE sf_responses SET texts = NULL WHERE texts IS NOT NULL AND day < date('now', '-12 months')"),
    c.env.DB.prepare("DELETE FROM sf_responses WHERE day < date('now', '-3 years')"),
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
  'Сигнал = честота, ясно над средната за страната (същата вълна, същият етап): поне 10 души, съществен дял и долна граница на 95% интервал над средното. Сигналът е повод за проверка, не доказателство за нарушение.',
  'Ефект на училището = същото дете в учебни седмици срещу ваканция. Така влиянието на училището се отделя от семейството и самото дете.',
];

sf.get('/methodology', (c) => c.json({ version: Q.version, dimensions: Q.dimensions, pillars: Q.pillars, params: Q.params, notes: METHOD_NOTES,
  indicators: Q.indicators, teacher_indicators: Q.teacher_indicators }));

sf.get('/whoami', async (c) => {
  const k = await callerKey(c);
  if (k.scope === 'invalid') throw new HttpError(403, 'Невалиден ключ.');
  const nm = await names(c.env.DB, [['school', k.school_id || ''], ['teacher', k.teacher_id || ''], ['region', k.region_id || '']]);
  return c.json({ scope: k.scope, label: k.label ?? null, school_id: k.school_id ?? null, teacher_id: k.teacher_id ?? null,
    region_id: k.region_id ?? null, school_name: nm[`school|${k.school_id}`] ?? null, teacher_name: nm[`teacher|${k.teacher_id}`] ?? null,
    region_name: nm[`region|${k.region_id}`] ?? null });
});

async function waves(db: D1Database) {
  const rows = await db.prepare('SELECT id, title, demo, open, created_at, computed_at, meta FROM sf_waves ORDER BY created_at, id').all<Dict>();
  return rows.results.map((w) => ({ id: w.id, title: w.title || w.id, demo: !!w.demo, open: !!w.open, computed: !!w.computed_at, created_at: w.created_at,
    computed_at: w.computed_at, meta: w.meta ? JSON.parse(w.meta) : null }));
}

sf.get('/waves', async (c) => {
  const ws = (await waves(c.env.DB)).filter((w) => w.computed);
  // references: national rates of the same wave (per stage and role), the yardstick every unit is compared with
  return c.json({ waves: ws.map(({ id, title, demo, computed_at, meta }) => ({ id, title, demo, computed_at, responses: meta?.included ?? null,
    references: meta?.references ?? null })) });
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

const PARENT_OF: Dict<string | null> = { class: 'school', school: 'region', region: 'system', teacher: 'school', system: null };

/** The key's scope as SQL over sf_units (alias u); mirrors canSee(). */
function scopeSql(key: Key, level: string): { sql: string; args: unknown[] } | null {
  const sc = key.scope;
  if (sc === 'admin') return { sql: '', args: [] };
  if (sc === 'teacher') return level === 'teacher' ? { sql: ' AND u.unit_id = ?', args: [key.teacher_id] } : null;
  if (level === 'system' || level === 'region' || level === 'school') return { sql: '', args: [] };
  if (sc === 'researcher' && level === 'class') return { sql: '', args: [] };
  if (sc === 'school_admin' && (level === 'class' || level === 'teacher')) return { sql: ' AND u.parent_id = ?', args: [key.school_id] };
  if (sc === 'inspector' && (level === 'class' || level === 'teacher')) {
    return key.region_id ? { sql: ' AND u.region_id = ?', args: [key.region_id] } : { sql: '', args: [] };
  }
  return null;
}

/** One query; the response JSON is stitched from the stored summary strings, so nothing is parsed per unit. */
sf.get('/units', async (c) => {
  const key = await callerKey(c);
  const level = c.req.query('level') || 'school';
  if (!(LEVELS as readonly string[]).includes(level)) throw new HttpError(400, 'bad level');
  const w = await resolveWave(c);
  const scope = scopeSql(key, level);
  const tier = c.req.query('tier');
  let parts: string[] = [];
  if (scope) {
    const rows = await c.env.DB.prepare(
      `SELECT u.summary, COALESCE(n.name, CASE WHEN u.level = 'system' THEN 'България' ELSE u.unit_id END) AS name,
              COALESCE(pn.name, u.parent_id) AS pname
         FROM sf_units u
         LEFT JOIN sf_names n ON n.level = u.level AND n.unit_id = u.unit_id
         LEFT JOIN sf_names pn ON pn.level = ? AND pn.unit_id = u.parent_id
        WHERE u.wave_id = ? AND u.level = ? AND u.suppressed = 0${scope.sql}${tier ? ' AND u.tier = ?' : ''}
        ORDER BY u.score IS NULL, u.score DESC`)
      .bind(PARENT_OF[level] ?? '', w.id, level, ...scope.args, ...(tier ? [tier] : [])).all<{ summary: string; name: string; pname: string | null }>();
    parts = rows.results.map((r) => `{"name":${JSON.stringify(r.name)},"parent_name":${JSON.stringify(r.pname)},${r.summary.slice(1)}`);
  }
  return c.body(`{"wave":${JSON.stringify(w.id)},"demo":${w.demo},"level":${JSON.stringify(level)},"count":${parts.length},"units":[${parts.join(',')}]}`,
    200, { 'Content-Type': 'application/json; charset=UTF-8' });
});

interface UnitMeta { region: string | null; signals: string }
const META = new WeakMap<Dict, UnitMeta>();   // region and signals travel beside the unit, never inside its JSON

async function unitRow(c: C, wave: string, level: string, uid: string, key: Key): Promise<Dict> {
  const r = await c.env.DB.prepare('SELECT data, region_id, signals FROM sf_units WHERE wave_id = ? AND level = ? AND unit_id = ?')
    .bind(wave, level, uid).first<{ data: string; region_id: string | null; signals: string | null }>();
  const unit = r ? JSON.parse(r.data) : null;
  if (!unit || unit.suppressed || !canSee(key, level, unit, r!.region_id)) throw new HttpError(404, 'not found or not permitted');
  META.set(unit, { region: r!.region_id, signals: r!.signals || '[]' });
  return unit;
}

sf.get('/units/:level/:id', async (c) => {
  const key = await callerKey(c);
  const { level, id } = c.req.param();
  const w = await resolveWave(c);
  const unit = await unitRow(c, w.id, level, id, key);
  const meta = META.get(unit)!;
  const [named] = await withNames(c.env.DB, level, [publicView(level, unit)]);
  const { themes, ...rest } = named;
  const signals = !unit.publish_blocked && canSeeSignals(key, level, unit, meta.region) ? JSON.parse(meta.signals) : undefined;
  return c.json({ wave: w.id, demo: w.demo, ...rest, ...(signals ? { signals } : {}) });
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
  const rows = await c.env.DB.prepare('SELECT wave_id, data, region_id FROM sf_units WHERE level = ? AND unit_id = ?').bind(level, id).all<{ wave_id: string; data: string; region_id: string | null }>();
  const cur = ws.get(c.req.query('wave') || '');
  const out = rows.results
    .map((r) => ({ w: ws.get(r.wave_id), x: JSON.parse(r.data), region: r.region_id }))
    .filter(({ w, x, region }) => w && (!cur || w.demo === cur.demo) && !x.suppressed && !x.publish_blocked && canSee(key, level, x, region))
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

/** Units with signals in a wave, for the inspectorate, the school or the teacher concerned. One query, stitched JSON. */
sf.get('/signals', async (c) => {
  const key = await callerKey(c);
  const scope = signalsScopeSql(key);
  if (!scope) throw new HttpError(403, 'Сигналите са достъпни за инспектората, училището и съответния учител.');
  const w = await resolveWave(c);
  const level = c.req.query('level');
  if (level && !(LEVELS as readonly string[]).includes(level)) throw new HttpError(400, 'bad level');
  const rows = await c.env.DB.prepare(
    `SELECT u.level, u.unit_id, u.signals, u.summary,
            COALESCE(n.name, u.unit_id) AS name, COALESCE(pn.name, u.parent_id) AS pname, COALESCE(rn.name, u.region_id) AS rname
       FROM sf_units u
       LEFT JOIN sf_names n ON n.level = u.level AND n.unit_id = u.unit_id
       LEFT JOIN sf_names pn ON pn.level = CASE u.level WHEN 'class' THEN 'school' WHEN 'teacher' THEN 'school' WHEN 'school' THEN 'region' ELSE '' END
                             AND pn.unit_id = u.parent_id
       LEFT JOIN sf_names rn ON rn.level = 'region' AND rn.unit_id = u.region_id
      WHERE u.wave_id = ? AND u.n_signals > 0 AND u.suppressed = 0${level ? ' AND u.level = ?' : ''}${scope.sql}
      ORDER BY u.n_signals DESC, u.level, name`)
    .bind(w.id, ...(level ? [level] : []), ...scope.args)
    .all<{ level: string; unit_id: string; signals: string; summary: string; name: string; pname: string | null; rname: string | null }>();
  const items = rows.results.map((r) => `{"level":${JSON.stringify(r.level)},"unit_id":${JSON.stringify(r.unit_id)},"name":${JSON.stringify(r.name)},`
    + `"parent_name":${JSON.stringify(r.pname)},"region_name":${JSON.stringify(r.rname)},"signals":${r.signals},"summary":${r.summary}}`);
  return c.body(`{"wave":${JSON.stringify(w.id)},"demo":${w.demo},"count":${items.length},"units":[${items.join(',')}]}`, 200,
    { 'Content-Type': 'application/json; charset=UTF-8' });
});

// ------------------------------------------------------------------ admin
async function requireAdmin(c: C) {
  if ((await callerKey(c)).scope !== 'admin') {
    throw new HttpError(403, c.env.SF_ADMIN_KEY || c.env.SF_ADMIN_KEY_SHA256 ? 'Нужен е администраторски ключ.' : 'Администрирането не е настроено: задайте SF_ADMIN_KEY_SHA256 в wrangler.jsonc.');
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
  if (!['researcher', 'school_admin', 'teacher', 'inspector', 'admin'].includes(scope)) throw new HttpError(400, 'Невалиден обхват.');
  if (scope === 'school_admin' && !b.school_id) throw new HttpError(400, 'Нужно е училище.');
  if (scope === 'teacher' && !b.teacher_id) throw new HttpError(400, 'Нужен е учител.');
  const key = newKey();
  await c.env.DB.prepare('INSERT INTO sf_keys (hash, scope, school_id, teacher_id, region_id, label) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256('sf-key|' + key), scope, b.school_id || null, b.teacher_id || null, scope === 'inspector' ? b.region_id || null : null,
      String(b.label || '').slice(0, 100) || null).run();
  return c.json({ key, scope }, 201);
});

sf.get('/admin/keys', async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare('SELECT substr(hash, 1, 12) AS id, scope, school_id, teacher_id, region_id, label, created_at FROM sf_keys ORDER BY created_at DESC').all();
  return c.json({ keys: rows.results });
});

sf.delete('/admin/keys/:id', async (c) => {
  await requireAdmin(c);
  await c.env.DB.prepare('DELETE FROM sf_keys WHERE substr(hash, 1, 12) = ?').bind(c.req.param('id')).run();
  return c.json({ deleted: c.req.param('id') });
});

// ------------------------------------------------------------------ admin: school register and proposals
/** Bulk import of the register (e.g. the МОН list of active institutions), up to 1000 rows per call. */
sf.post('/admin/schools', async (c) => {
  await requireAdmin(c);
  const b = await body(c, 1024 * 1024);
  const rows = (Array.isArray(b.schools) ? b.schools : []).slice(0, 1000);
  const str = (v: unknown, n: number) => (v == null || v === '' ? null : String(v).trim().slice(0, n));
  const stmts = rows.map((r: Dict) => c.env.DB.prepare(`INSERT INTO sf_schools (school_id, name, town, region_id, region_name, source) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(school_id) DO UPDATE SET name = excluded.name, town = excluded.town, region_id = excluded.region_id,
      region_name = excluded.region_name, source = excluded.source`)
    .bind(id(r.school_id, 'училище'), str(r.name, 160) || id(r.school_id, 'училище'), str(r.town, 80), r.region_id ? id(r.region_id, 'регион') : null,
      str(r.region_name, 80), str(r.source, 40) || 'import'));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  const total = await c.env.DB.prepare('SELECT count(*) AS n FROM sf_schools').first<{ n: number }>();
  return c.json({ imported: stmts.length, total: total?.n || 0 });
});

sf.get('/admin/school-requests', async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare("SELECT * FROM sf_school_requests WHERE status = 'pending' ORDER BY created_at LIMIT 200").all();
  return c.json({ requests: rows.results });
});

sf.post('/admin/school-requests/:id', async (c) => {
  await requireAdmin(c);
  const b = await body(c);
  const req = await c.env.DB.prepare('SELECT * FROM sf_school_requests WHERE id = ?').bind(c.req.param('id')).first<Dict>();
  if (!req) throw new HttpError(404, 'Няма такова предложение.');
  if (b.action === 'approve') {
    const schoolId = b.school_id ? id(b.school_id, 'училище') : 'u-' + req.id.slice(0, 8);
    const regionName = String(b.region_name || req.region_name || '').trim().slice(0, 80) || null;
    const regionId = b.region_id ? id(b.region_id, 'регион') : regionName ? regionName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 64) : null;
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO sf_schools (school_id, name, town, region_id, region_name, source) VALUES (?, ?, ?, ?, ?, 'proposal')`)
        .bind(schoolId, String(b.name || req.name).slice(0, 160), req.town, regionId, regionName),
      c.env.DB.prepare("UPDATE sf_school_requests SET status = 'approved' WHERE id = ?").bind(req.id),
    ]);
    return c.json({ status: 'approved', school_id: schoolId });
  }
  await c.env.DB.prepare("UPDATE sf_school_requests SET status = 'rejected' WHERE id = ?").bind(req.id).run();
  return c.json({ status: 'rejected' });
});

/**
 * Wave export for the operator console, page by page (keeps each request small): numeric answers + the themes
 * recorded at submit. Free text itself never leaves the server. Strings are concatenated, not parsed.
 */
sf.get('/admin/waves/:id/export', async (c) => {
  await requireAdmin(c);
  const wid = c.req.param('id');
  const after = Number(c.req.query('after') || 0);
  const PAGE = 250;
  const rows = await c.env.DB.prepare('SELECT rowid, payload, themes FROM sf_responses WHERE wave_id = ? AND rowid > ? ORDER BY rowid LIMIT ?')
    .bind(wid, after, PAGE).all<{ rowid: number; payload: string; themes: string | null }>();
  const last = rows.results.at(-1)?.rowid ?? null;
  let sizes = '';
  if (!after) {
    const cs = await c.env.DB.prepare('SELECT class_id, class_size FROM sf_classes WHERE wave_id = ? AND class_size > 0').bind(wid).all<Dict>();
    sizes = `"class_sizes":${JSON.stringify(Object.fromEntries(cs.results.map((r) => [r.class_id, r.class_size])))},`;
  }
  const items = rows.results.map((r) => `{"r":${r.payload},"t":${r.themes || 'null'}}`).join(',');
  return c.body(`{${sizes}"next":${rows.results.length === PAGE ? last : 'null'},"items":[${items}]}`, 200,
    { 'Content-Type': 'application/json; charset=UTF-8' });
});

/**
 * Upload of a wave computed in the console, in chunks: unit rows (publish.ts), optional names, and on the last
 * chunk the wave meta. reset=true on the first chunk replaces earlier results. Demo waves are created here too.
 */
sf.post('/admin/waves/:id/units', async (c) => {
  await requireAdmin(c);
  const wid = id(c.req.param('id'), 'вълна');
  const b = await body(c, 1024 * 1024);
  const units: Dict[] = Array.isArray(b.units) ? b.units : [];
  const nm: unknown[][] = Array.isArray(b.names) ? b.names : [];
  if (units.length > 200 || nm.length > 500) throw new HttpError(400, 'Твърде много редове в една част.');
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];
  if (b.demo) {
    stmts.push(db.prepare(`INSERT INTO sf_waves (id, title, demo, open, created_at) VALUES (?, ?, 1, 0, COALESCE(?, datetime('now')))
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, demo = 1, open = 0`).bind(wid, String(b.title || wid).slice(0, 100), b.created_at || null));
  } else if (!(await db.prepare('SELECT 1 FROM sf_waves WHERE id = ?').bind(wid).first())) {
    throw new HttpError(404, 'Няма такава вълна.');
  }
  if (b.reset) stmts.push(db.prepare('DELETE FROM sf_units WHERE wave_id = ?').bind(wid));
  for (const u of units) {
    if (!(LEVELS as readonly string[]).includes(u.level) || typeof u.summary !== 'string' || typeof u.data !== 'string') throw new HttpError(400, 'Невалиден ред.');
    if (u.signals !== undefined && typeof u.signals !== 'string') throw new HttpError(400, 'Невалиден ред.');
    stmts.push(db.prepare(`INSERT OR REPLACE INTO sf_units (wave_id, level, unit_id, parent_id, suppressed, score, tier, summary, data, region_id, n_signals, signals)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(wid, u.level, id(u.unit_id, 'единица'), u.parent_id ?? null, u.suppressed ? 1 : 0,
      typeof u.score === 'number' ? u.score : null, u.tier ?? null, u.summary, u.data, u.region_id ?? null,
      Number.isInteger(u.n_signals) ? u.n_signals : 0, u.signals ?? '[]'));
  }
  for (const [lv, uid, name] of nm) {
    if (typeof lv === 'string' && typeof uid === 'string' && typeof name === 'string') {
      stmts.push(db.prepare(`INSERT INTO sf_names (level, unit_id, name) VALUES (?, ?, ?) ON CONFLICT(level, unit_id) DO ${b.demo ? 'NOTHING' : 'UPDATE SET name = excluded.name'}`)
        .bind(lv, uid, name.slice(0, 120)));
    }
  }
  const meta = b.meta ? JSON.stringify(b.meta) : null;
  if (meta && meta.length > 60000) throw new HttpError(400, 'Мета данните са твърде големи.');
  if (meta) stmts.push(db.prepare(`UPDATE sf_waves SET computed_at = datetime('now'), meta = ? WHERE id = ?`).bind(meta, wid));
  if (stmts.length) await db.batch(stmts);
  return c.json({ wave: wid, stored: units.length });
});
