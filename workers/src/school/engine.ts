/**
 * Scoring and rating engine for the school feedback platform.
 *
 * Port of school-feedback/engine.py (the reference implementation). The deterministic parts – flow,
 * respondent scoring, quality weights, aggregation, shrinkage, tiers – match the Python output; only the
 * random streams (teacher tie-breaks, bootstrap, simulation) use a different PRNG, so bootstrap intervals
 * agree statistically, not digit for digit. scripts/school-parity.mjs checks this against engine.py.
 *
 * Everything that is a policy choice lives in questionnaire.json -> params, not in this file.
 */
import QJSON from '../../../school-feedback/questionnaire.json';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dict<T = any> = Record<string, T>;
export type Questionnaire = Dict & { _by_id: Dict; params: Dict; items: Dict[]; modules: Dict[]; dimensions: Dict; pillars: Dict };
export type Answers = Dict<number | number[] | string | null>;

export function loadQuestionnaire(): Questionnaire {
  const q = structuredClone(QJSON) as unknown as Questionnaire;
  q._by_id = Object.fromEntries(q.items.map((it: Dict) => [it.id, it]));
  return q;
}

// =============================================================================== small helpers
/** Python's round(x, nd): round half to even on the decimal representation. */
export function pyRound(x: number, nd = 0): number {
  const f = 10 ** nd;
  const y = x * f;
  const r = Math.round(y);
  // exact .5 ties go to even, like Python
  if (Math.abs(y % 1) === 0.5) return (2 * Math.round(y / 2)) / f;
  return r / f;
}

/** Synchronous SHA-256 (hex). Flow sampling must be deterministic and synchronous. */
export function sha256Hex(msg: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(msg);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, bits >>> 0);
  dv.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Deterministic pseudo-random number in [0,1) from strings (same as engine.py _h). */
export function hashUnit(...parts: unknown[]): number {
  return parseInt(sha256Hex(parts.map(String).join('|')).slice(0, 12), 16) / 16 ** 12;
}

/** Seeded PRNG (mulberry32) with the few Python random.Random methods the engine uses. */
export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  random(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  randrange(n: number): number { return Math.floor(this.random() * n); }
  uniform(a: number, b: number): number { return a + (b - a) * this.random(); }
  choice<T>(xs: T[]): T { return xs[this.randrange(xs.length)]; }
  gauss(mu = 0, sigma = 1): number {
    if (this.spare !== null) { const z = this.spare; this.spare = null; return mu + sigma * z; }
    let u = 0;
    while (u === 0) u = this.random();
    const v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return mu + sigma * r * Math.cos(2 * Math.PI * v);
  }
  sample<T>(xs: T[], k: number): T[] {
    const pool = xs.slice();
    for (let i = 0; i < k; i++) {
      const j = i + this.randrange(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const isNum = (v: unknown): v is number => typeof v === 'number';

// =============================================================================== questionnaire
export function stageOf(q: Questionnaire, grade: number): string {
  for (const [st, [lo, hi]] of Object.entries(q.params.stages as Dict<[number, number]>)) {
    if (lo <= grade && grade <= hi) return st;
  }
  throw new Error(`grade out of range: ${grade}`);
}

export function isYoung(q: Questionnaire, role: string, grade: number): boolean {
  const [lo, hi] = q.params.young_student_grades;
  return role === 'student' && lo <= grade && grade <= hi;
}

export interface Variant {
  id: string; text: string; options: string[] | null; score: Dict | null; type: string;
  dimension: string | null; weight: number; aspect: string | null; module: string; teacher_id?: string;
  /** grid items: each row is answered on its own id (e.g. SC01_S / SC01_V) */
  rows?: { id: string; label: string }[];
}

export function variant(q: Questionnaire, it: Dict, role: string, grade: number): Variant {
  const y: Dict | null = isYoung(q, role, grade) ? it.young || null : null;
  const text = y?.text || it.text[role] || it.text.parent;
  const scale = y?.scale || it.scale;
  let options = y?.options || (scale ? q.scales[scale] : it.options);
  if (y && !('options' in y) && !('scale' in y)) {
    options = it.options || (it.scale ? q.scales[it.scale] : null);
  }
  const score = y && 'score' in y ? y.score : it.score;
  const v: Variant = {
    id: it.id, text, options: options ?? null, score: score ?? null, type: y?.type ?? it.type,
    dimension: it.dimension ?? null, weight: it.weight ?? 1.0, aspect: it.aspect ?? null, module: it.module,
  };
  if (it.rows) v.rows = it.rows;
  return v;
}

export function applies(q: Questionnaire, it: Dict, role: string, grade: number): boolean {
  if (!it.roles.includes(role)) return false;
  const [lo, hi] = it.grades_by_role?.[role] ?? it.grades;
  if (!(lo <= grade && grade <= hi)) return false;
  if (isYoung(q, role, grade) && !('young' in it)) return false;
  return Boolean(it.text[role]) || Boolean(it.young);
}

// =============================================================================== condition DSL
export function evalCond(cond: Dict | null | undefined, answers: Answers, ctx: Dict): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c: Dict) => evalCond(c, answers, ctx));
  if ('any' in cond) return cond.any.some((c: Dict) => evalCond(c, answers, ctx));
  if ('not' in cond) return !evalCond(cond.not, answers, ctx);
  const val: any = 'q' in cond ? answers[cond.q] : ctx[cond.ctx];
  const { op, v } = cond;
  if (op === 'answered') return val !== undefined && val !== null && !(Array.isArray(val) && !val.length) && val !== '';
  if (val === undefined || val === null) return false;
  const vals: any[] = Array.isArray(val) ? val : [val];
  if (op === 'in') return vals.some((x) => v.includes(x));
  if (op === 'not_in') return vals.every((x) => !v.includes(x));
  if (op === 'eq') return val === v;
  if (op === 'gte') return val >= v;
  if (op === 'lte') return val <= v;
  throw new Error(`unknown op ${op}`);
}

// =============================================================================== teacher assignment
export interface Teacher { teacher_id: string; name?: string; subject?: string; is_class_teacher?: boolean }

/**
 * Parent -> class teacher only. Student in the short (grade 4) form -> class teacher only.
 * Student -> class teacher + k others, taken from the least-rated teachers so far (balances coverage).
 */
export function assignTeachers(q: Questionnaire, token: string, role: string, classTeachers: Teacher[],
  ratingCounts: Dict<number> = {}, grade?: number): Teacher[] {
  const p = q.params.teacher_assignment;
  const head = classTeachers.filter((t) => t.is_class_teacher);
  if (role === 'parent' || (grade !== undefined && isYoung(q, role, grade))) return head.slice(0, 1);
  const pool = classTeachers.filter((t) => !t.is_class_teacher);
  const rng = new Rng(Math.floor(hashUnit('assign', token) * 2 ** 32));
  const chosen: Teacher[] = [];
  const n = Math.min(p.extra_teachers, pool.length);
  for (let i = 0; i < n; i++) {
    const least = Math.min(...pool.map((t) => ratingCounts[t.teacher_id] || 0));
    const cands = pool.map((t, j) => [t, j] as const).filter(([t]) => (ratingCounts[t.teacher_id] || 0) === least).map(([, j]) => j);
    chosen.push(pool.splice(cands[rng.randrange(cands.length)], 1)[0]);
  }
  return [...(p.always_class_teacher ? head.slice(0, 1) : []), ...chosen];
}

// =============================================================================== flow
/** Ordered list of questions to show. TC items are repeated per teacher with id "TC01@<teacher_id>". */
export function flow(q: Questionnaire, ctx: { role: string; grade: number; token?: string }, answers: Answers = {},
  teachers: Teacher[] = []): Variant[] {
  const { role, grade } = ctx;
  if (role === 'student' && grade < q.params.student_min_grade) {
    throw new Error('Учениците от I–III клас не попълват анкета; попълва родителят.');
  }
  const fullCtx = { ...ctx, stage: stageOf(q, grade), young: isYoung(q, role, grade) };
  const out: Variant[] = [];
  for (const mod of q.modules) {
    const rate = mod.sampling_rate;
    if (rate !== undefined && rate !== null && hashUnit('sample', ctx.token ?? '', mod.id) >= rate) continue;
    const modItems = q.items.filter((it) => it.module === mod.id && applies(q, it, role, grade));
    if (mod.repeat === 'teacher') {
      for (const t of teachers) {
        for (const it of modItems) {
          const v = variant(q, it, role, grade);
          v.text = v.text.replace('{teacher}', t.name || t.subject || 'учителят');
          v.id = `${it.id}@${t.teacher_id}`;
          v.teacher_id = t.teacher_id;
          out.push(v);
        }
      }
      continue;
    }
    for (const it of modItems) {
      if (evalCond(it.show_if, answers, fullCtx)) out.push(variant(q, it, role, grade));
    }
  }
  return out;
}

// =============================================================================== item scoring
export function normScore(q: Questionnaire, norm: string, value: number, grade: number): number {
  const n = q.params.norms;
  if (norm === 'homework_weekday' || norm === 'homework_weekend') {
    const hw = n.homework_weekday;
    let N = Math.min(hw.minutes_per_grade * grade, hw.cap_minutes);
    let zero: number;
    if (norm === 'homework_weekend') {
      N *= n.homework_weekend.multiple_of_weekday_norm;
      zero = n.homework_weekend.zero_at_multiple;
    } else {
      zero = hw.zero_at_multiple;
    }
    const m = value;
    if (m <= N) return 100.0;
    if (m >= zero * N) return 0.0;
    return 100.0 * (1 - (m - N) / ((zero - 1) * N));
  }
  if (norm === 'sleep') {
    const s = n.sleep;
    const need = grade <= 6 ? s.min_hours_by_grade['1-6'] : s.min_hours_by_grade['7-12'];
    return Math.max(0, Math.min(100, 100 - s.points_lost_per_hour * Math.max(0, need - value)));
  }
  throw new Error(norm);
}

export function itemScore(q: Questionnaire, v: Variant, value: unknown, grade: number): number | null {
  const spec = v.score;
  if (!spec || value === undefined || value === null || Array.isArray(value) || typeof value === 'string') return null;
  const a = value as number;
  const k = spec.kind;
  if (k === 'likert') {
    const n = (v.options as string[]).length;
    const s = (100.0 * a) / (n - 1);
    return (spec.polarity ?? 1) > 0 ? s : 100.0 - s;
  }
  if (k === 'map') return spec.values[a] ?? null;
  if (k === 'norm') {
    const m = spec.minutes[a];
    return m === null || m === undefined ? null : normScore(q, spec.norm, m, grade);
  }
  throw new Error(k);
}

export function gradeBand(q: Questionnaire, role: string, grade: number, answers: Answers): number | null {
  const bands: number[] = [];
  for (const qid of ['PR02A', 'PR02B_BEL', 'PR02B_MAT', 'PR02C_BEL', 'PR02C_MAT']) {
    const a = answers[qid];
    const it = q._by_id[qid];
    if (!isNum(a) || !applies(q, it, role, grade)) continue;
    const mapping = isYoung(q, role, grade) ? [5, 4, 3, 2, null] : [5, 4, 3, 2, 1, null];
    if (a < mapping.length && mapping[a] !== null) bands.push(mapping[a] as number);
  }
  return bands.length ? pyRound(sum(bands) / bands.length) : null;
}

// =============================================================================== respondent scoring
export interface Response {
  id?: string; token_hash?: string; mode?: string; role: string; grade: number;
  region_id: string; school_id: string; class_id: string; duration_s?: number | null;
  answers: Answers; teachers?: { teacher_id: string; name?: string; answers: Answers }[];
}

export interface Scored {
  id?: string; role: string; grade: number; stage: string; young: boolean;
  unit: Dict<string>; mode: string; duration_s: number | null;
  items: Dict<number | null>; dims: Dict<number>; teachers: Dict<{ score: number; aspects: Dict<number> }>;
  ctx: { gender: string | null; grade_band: number | null; tutoring: unknown; indicators: Dict<number | null> };
  flags: string[]; answers_vector: string; weight: number; excluded_reason: string | null; aspects?: Dict<number>;
  /** same child, school weeks minus vacation (engine.ts only; not part of the Python reference) */
  contrast: Contrast | null;
}

export interface Contrast { symptom_delta: number; pairs: number; sleep_lost_h: number | null }

export function scoreRespondent(q: Questionnaire, resp: Response): Scored {
  const { role, grade } = resp;
  const answers = resp.answers || {};
  const teachers = (resp.teachers || []).map((t) => ({ teacher_id: t.teacher_id, name: t.name || '' }));
  const visible = flow(q, { role, grade, token: resp.token_hash || '' }, answers, teachers);
  const items: Dict<number | null> = {};
  const perDim = new Map<string, [number | null, number][]>();
  const push = (d: string, x: [number | null, number]) => { if (!perDim.has(d)) perDim.set(d, []); perDim.get(d)!.push(x); };
  const tc = new Map<string, { aspects: Dict<number>; scores: number[] }>();
  const tAnswers: Dict<Answers> = Object.fromEntries((resp.teachers || []).map((t) => [t.teacher_id, t.answers || {}]));
  for (const v of visible) {
    if (v.type === 'notice' || v.type === 'text' || v.dimension === null) continue;
    if (v.teacher_id) {
      const base = v.id.split('@')[0];
      const s = itemScore(q, v, tAnswers[v.teacher_id]?.[base], grade);
      if (s !== null) {
        if (!tc.has(v.teacher_id)) tc.set(v.teacher_id, { aspects: {}, scores: [] });
        const x = tc.get(v.teacher_id)!;
        x.aspects[v.aspect as string] = s;
        x.scores.push(s);
      }
      continue;
    }
    const val = answers[v.id];
    const s = itemScore(q, v, val, grade);
    items[v.id] = s;
    // "Не знам"-type options score null and do not count as applicable
    const notApplicable = val !== undefined && val !== null && s === null;
    if (!notApplicable) push(v.dimension, [s, v.weight]);
  }
  for (const d of q.derived as Dict[]) {
    if (d.kind === 'sleep_hours') {
      const b = answers.SL01, w = answers.SL02;
      if (!isNum(b) || !isNum(w)) { push(d.dimension, [null, d.weight]); continue; }
      const hours = 24 - d.bed_hours[b] + d.wake_hours[w];
      const s = normScore(q, 'sleep', hours, grade);
      items[d.id] = s;
      push(d.dimension, [s, d.weight]);
    } else if (d.kind === 'tutoring_to_keep_up') {
      const t = answers.PR04;
      if (t === undefined || t === null) continue;
      const reasons = (answers.PR05 as number[]) || [];
      const keepUp = t === 2 && reasons.some((r) => d.keep_up_options.includes(r));
      const s = keepUp ? d.score.true : d.score.false;
      items[d.id] = s;
      push(d.dimension, [s, d.weight]);
    }
  }
  const cov = q.params.coverage;
  const dims: Dict<number> = {};
  for (const [dim, lst] of perDim) {
    const answered = lst.filter(([s]) => s !== null) as [number, number][];
    const need = Math.max(cov.min_items, Math.ceil(cov.min_share * lst.length));
    if (answered.length && answered.length >= need) {
      dims[dim] = sum(answered.map(([s, w]) => s * w)) / sum(answered.map(([, w]) => w));
    }
  }
  const teacherScores: Scored['teachers'] = {};
  for (const [tid, x] of tc) if (x.scores.length) teacherScores[tid] = { score: sum(x.scores) / x.scores.length, aspects: x.aspects };
  const ts = Object.values(teacherScores);
  if (ts.length) dims.TC = sum(ts.map((t) => t.score)) / ts.length;
  const g = answers.PR01;
  return {
    id: resp.id, role, grade, stage: stageOf(q, grade), young: isYoung(q, role, grade),
    unit: { region_id: resp.region_id, school_id: resp.school_id, class_id: resp.class_id },
    mode: resp.mode || 'closed', duration_s: resp.duration_s ?? null,
    items, dims, teachers: teacherScores,
    ctx: { gender: g === 0 ? 'boy' : g === 1 ? 'girl' : null, grade_band: gradeBand(q, role, grade, answers),
      tutoring: answers.PR04 ?? null, indicators: indicators(answers, role, grade, q) },
    flags: qualityFlags(q, resp, visible), answers_vector: answerVector(answers), weight: 1, excluded_reason: null,
    contrast: contrastOf(q, answers),
  };
}

/** Symptom frequency (0..100, higher = more often) in school weeks minus the vacation, and sleep lost in school weeks. */
function contrastOf(q: Questionnaire, a: Answers): Contrast | null {
  const c = q.params.contrast;
  const deltas: number[] = [];
  for (const id of c.symptoms as string[]) {
    const x = a[`${id}_S`], y = a[`${id}_V`];
    if (isNum(x) && isNum(y)) deltas.push((100 * (x - y)) / (q.scales.hbsc5.length - 1));
  }
  const xs = a[`${c.sleep}_S`], ys = a[`${c.sleep}_V`];
  const sleep = isNum(xs) && isNum(ys) ? c.sleep_midpoints[ys] - c.sleep_midpoints[xs] : null;
  if (deltas.length < c.worse_min_symptoms && sleep === null) return null;
  return { symptom_delta: deltas.length >= c.worse_min_symptoms ? sum(deltas) / deltas.length : NaN, pairs: deltas.length, sleep_lost_h: sleep };
}

function indicators(a: Answers, role: string, grade: number, q: Questionnaire): Dict<number | null> {
  const young = isYoung(q, role, grade);
  const has = (k: string) => a[k] !== undefined && a[k] !== null;
  const n = (k: string) => a[k] as number;
  const in_ = (k: string, xs: number[]) => xs.includes(n(k));
  return {
    tutoring_regular: !has('PR04') ? null : +(n('PR04') === 2),
    tutoring_keep_up: !has('PR04') ? null : +(n('PR04') === 2 && ((a.PR05 as number[]) || []).some((r) => r === 0 || r === 1)),
    vacation_tasks: !has('WL03') || n('WL03') === 3 ? null : +in_('WL03', [1, 2]),
    behaviour_note: !has('CD02') ? null : +(n('CD02') > 0),
    labelled_aggression_disputed: !has('CD06') || n('CD06') === 3 ? null : +in_('CD06', [1, 2]),
    recess_removed: !has('CD08') || n('CD08') === 3 ? null : +in_('CD08', [1, 2]),
    bullying_repeated: !has('SF01') ? null : +(n('SF01') >= 2),
    psychosomatic_often: !has('WB01') ? null : +(n('WB01') >= (young ? 2 : 3)),
    shouting_weekly: atLeast(a, 'HP01', 2),
    class_punishment: atLeast(a, 'HP02', 1),
    threats_weekly: atLeast(a, 'HP03', 2),
    sent_out: atLeast(a, 'HP04', 1),
    physical_force: !has('HP05') || n('HP05') === 3 ? null : +in_('HP05', [1, 2]),
    grade_as_punishment: !has('HP06') || n('HP06') === 2 ? null : +(n('HP06') === 1),
    ...wellbeing(a, q),
    school_worse: schoolWorse(a, q),
    sleep_short: sleepShort(a, q, grade),
    homework_over_norm: homeworkOver(a, q, role, grade),
  };
}

const atLeast = (a: Answers, id: string, k: number) => (isNum(a[id]) ? +((a[id] as number) >= k) : null);

/** WHO-5 raw score 0..100 = 4 x sum of (5 - answer index); only when all five items are answered. */
function wellbeing(a: Answers, q: Questionnaire): Dict<number | null> {
  const vals = [1, 2, 3, 4, 5].map((i) => a[`WH0${i}`]);
  if (!vals.every(isNum)) return { low_wellbeing: null, very_low_wellbeing: null };
  const raw = 4 * sum((vals as number[]).map((v) => 5 - v));
  const p = q.params.who5;
  return { low_wellbeing: +(raw <= p.low), very_low_wellbeing: +(raw <= p.very_low) };
}

function schoolWorse(a: Answers, q: Questionnaire): number | null {
  const c = q.params.contrast;
  const pairs = (c.symptoms as string[]).map((id) => [a[`${id}_S`], a[`${id}_V`]]).filter(([x, y]) => isNum(x) && isNum(y)) as [number, number][];
  if (pairs.length < c.worse_min_symptoms) return null;
  return +(pairs.filter(([x, y]) => x - y >= c.worse_steps).length >= c.worse_min_symptoms);
}

function sleepShort(a: Answers, q: Questionnaire, grade: number): number | null {
  const d = (q.derived as Dict[]).find((x) => x.kind === 'sleep_hours');
  const b = a.SL01, w = a.SL02;
  if (!d || !isNum(b) || !isNum(w)) return null;
  const hours = 24 - d.bed_hours[b] + d.wake_hours[w];
  return +(hours < q.params.norms.sleep.min_hours_by_grade[grade <= 6 ? '1-6' : '7-12']);
}

function homeworkOver(a: Answers, q: Questionnaire, role: string, grade: number): number | null {
  const v = a.WL01;
  if (!isNum(v)) return null;
  const mins: (number | null)[] = variant(q, q._by_id.WL01, role, grade).score?.minutes || [];
  if (v >= mins.length || mins[v] === null || mins[v] === undefined) return null;
  const hw = q.params.norms.homework_weekday;
  return +((mins[v] as number) > q.params.homework_over_multiple * Math.min(hw.minutes_per_grade * grade, hw.cap_minutes));
}

function answerVector(a: Answers): string {
  const keys = Object.keys(a).filter((k) => typeof a[k] !== 'string').sort();
  return JSON.stringify(keys.map((k) => [k, a[k]]));
}

function qualityFlags(q: Questionnaire, resp: Response, visible: Variant[]): string[] {
  const a = resp.answers || {};
  const flags: string[] = [];
  const qp = q.params.quality;
  const lik = visible.filter((v) => v.score && v.score.kind === 'likert' && a[v.id] !== undefined && a[v.id] !== null);
  if (lik.length >= qp.straightline_min_items && !isYoung(q, resp.role, resp.grade)) {
    const idx = new Set(lik.map((v) => a[v.id]));
    const pols = new Set(lik.map((v) => v.score!.polarity ?? 1));
    if (idx.size === 1 && pols.size === 2) flags.push('straightline');
  }
  if (a.QC01 !== undefined && a.QC01 !== null && a.QC01 !== 1) flags.push('attention_failed');
  if (a.WL01 === 0 && a.WL07 === 4) flags.push('inconsistent_workload');
  return flags;
}

// =============================================================================== quality weights
/** Sets weight (0, 0.5, 1 ...) and excluded_reason. Duration rule uses medians per (role, young). */
export function applyQuality(q: Questionnaire, scored: Scored[]): Scored[] {
  const qp = q.params.quality;
  const byForm = new Map<string, number[]>();
  for (const r of scored) {
    if (r.duration_s === null) continue;
    const k = `${r.role}|${r.young}`;
    if (!byForm.has(k)) byForm.set(k, []);
    byForm.get(k)!.push(r.duration_s);
  }
  const med = new Map<string, number>();
  for (const [k, v] of byForm) { const s = v.slice().sort((x, y) => x - y); med.set(k, s[Math.floor(s.length / 2)]); }
  for (const r of scored) {
    let w = 1.0;
    let why: string | null = null;
    const d = r.duration_s;
    const m = med.get(`${r.role}|${r.young}`);
    if (d !== null && (d < qp.min_seconds || (m && d < qp.exclude_below_median_share * m))) {
      w = 0; why = 'too_fast';
    } else if (r.flags.includes('straightline')) {
      w = 0; why = 'straightline';
    } else {
      if (d !== null && m && d < qp.flag_below_median_share * m) w *= qp.flag_weight;
      if (r.flags.includes('attention_failed') || r.flags.includes('inconsistent_workload')) w *= qp.flag_weight;
    }
    if (r.mode === 'open') w *= qp.open_mode_weight;
    r.weight = w;
    r.excluded_reason = why;
  }
  return scored;
}

// =============================================================================== statistics helpers
interface WStats { mean: number; var: number; n_eff: number; n: number }

/** Weighted mean, variance, effective n (Kish), raw n. Winsorises 5/95% when n >= 20. */
function wstats(xs: (number | null | undefined)[], ws: number[]): WStats | null {
  let pairs: [number, number][] = [];
  xs.forEach((x, i) => { if (ws[i] > 0 && x !== null && x !== undefined) pairs.push([x, ws[i]]); });
  const n = pairs.length;
  if (!n) return null;
  if (n >= 20) {
    const srt = pairs.map(([x]) => x).sort((a, b) => a - b);
    const lo = srt[Math.floor(0.05 * (n - 1))], hi = srt[Math.ceil(0.95 * (n - 1))];
    pairs = pairs.map(([x, w]) => [Math.min(Math.max(x, lo), hi), w]);
  }
  const sw = sum(pairs.map(([, w]) => w));
  const mu = sum(pairs.map(([x, w]) => x * w)) / sw;
  const v = (sum(pairs.map(([x, w]) => w * (x - mu) ** 2)) / sw) * (n > 1 ? n / (n - 1) : 1.0);
  const nEff = sw ** 2 / sum(pairs.map(([, w]) => w * w));
  return { mean: mu, var: Math.max(v, 1.0), n_eff: nEff, n };
}

interface Combined { mean: number; var: number; roles: Dict<{ n: number; mean: number }>; n: number }

function combineRoles(q: Questionnaire, dim: string, perRole: Dict<WStats | null>, stage: string, kRole: number, level: string): Combined | null {
  const rw: Dict<number> = { ...q.dimensions[dim].role_weights };
  if (stage === 'I') rw.student *= q.params.young_student_weight_factor;
  const use: Dict<WStats> = {};
  for (const [r, s] of Object.entries(perRole)) if (s && s.n >= kRole && (rw[r] || 0) > 0) use[r] = s;
  if (level === 'teacher') {
    const kt = q.params.k_anonymity.teacher_min_students;
    if (perRole.student && perRole.student.n < kt) delete use.student;
  }
  const roles = Object.keys(use);
  if (!roles.length) return null;
  const tot = sum(roles.map((r) => rw[r]));
  return {
    mean: sum(roles.map((r) => (rw[r] / tot) * use[r].mean)),
    var: sum(roles.map((r) => (rw[r] / tot) ** 2 * use[r].var / use[r].n_eff)),
    roles: Object.fromEntries(roles.map((r) => [r, { n: use[r].n, mean: pyRound(use[r].mean, 1) }])),
    n: sum(roles.map((r) => use[r].n)),
  };
}

const LEVEL_KEY: Dict<string | null> = { class: 'class_id', school: 'school_id', region: 'region_id', system: null };
export const PARENT_LEVEL: Dict<string | null> = { class: 'school', school: 'region', region: 'system', teacher: 'school', system: null };

const unitOf = (r: Scored, level: string) => (LEVEL_KEY[level] === null ? 'BG' : r.unit[LEVEL_KEY[level] as string]);

function dominantStage(rs: Scored[]): string {
  const c = new Map<string, number>();
  for (const r of rs) c.set(r.stage, (c.get(r.stage) || 0) + 1);
  let best = '', bn = -1;
  for (const [k, v] of c) if (v > bn) { best = k; bn = v; }
  return best;
}

function rawUnitDims(q: Questionnaire, rs: Scored[], level: string): Dict<Combined> {
  const k = q.params.k_anonymity.role_cell;
  const stage = dominantStage(rs);
  const out: Dict<Combined> = {};
  for (const dim of Object.keys(q.dimensions)) {
    const perRole: Dict<WStats | null> = {};
    for (const role of ['parent', 'student']) {
      const sub = rs.filter((r) => r.role === role);
      perRole[role] = wstats(sub.map((r) => r.dims[dim]), sub.map((r) => r.weight));
    }
    const c = combineRoles(q, dim, perRole, stage, k, level);
    if (c) out[dim] = c;
  }
  return out;
}

/** Explode respondent-teacher ratings into pseudo-respondents for the teacher level. */
function teacherRecords(scored: Scored[]): Scored[] {
  const out: Scored[] = [];
  for (const r of scored) {
    for (const [tid, t] of Object.entries(r.teachers)) {
      out.push({ ...r, unit: { ...r.unit, teacher_id: tid }, dims: { TC: t.score }, aspects: t.aspects });
    }
  }
  return out;
}

function indexFrom(q: Questionnaire, dims: Dict<number>): [Dict<number>, number | null] {
  const pill: Dict<number> = {};
  for (const pid of Object.keys(q.pillars)) {
    const vals = Object.entries(q.dimensions).filter(([d, meta]) => meta.pillar === pid && d in dims).map(([d]) => dims[d]);
    if (vals.length) pill[pid] = sum(vals) / vals.length;
  }
  if (Object.keys(pill).length < Object.keys(q.pillars).length) return [pill, null];
  const tw = sum(Object.keys(pill).map((p) => q.pillars[p].weight));
  return [pill, sum(Object.entries(pill).map(([p, v]) => q.pillars[p].weight * v)) / tw];
}

function band(q: Questionnaire, x: number | null): string | null {
  if (x === null) return null;
  for (const [thr, label] of q.params.absolute_bands as [number, string][]) if (x >= thr) return label;
  return q.params.absolute_bands.at(-1)[1];
}

// =============================================================================== aggregation
export function aggregate(q: Questionnaire, scored: Scored[], level: string,
  opts: { seed?: number; bootstrap?: boolean; classSizes?: Dict<number> | null; refs?: Refs } = {}): Dict<Dict> {
  const { seed = 1, bootstrap = true, classSizes = null } = opts;
  const natRefs = opts.refs ?? references(q, scored);
  const P = q.params;
  const z = P.interval_z;
  let recs: Scored[], key: (r: Scored) => string, parentKey: ((r: Scored) => string) | null, parentLevelName: string | null;
  if (level === 'teacher') {
    recs = teacherRecords(scored);
    key = (r) => r.unit.teacher_id;
    parentKey = (r) => r.unit.school_id;
    parentLevelName = 'school';
  } else {
    recs = scored;
    key = (r) => unitOf(r, level);
    const pl = PARENT_LEVEL[level];
    parentKey = pl ? (r) => unitOf(r, pl) : null;
    parentLevelName = pl;
  }
  const groups = new Map<string, Scored[]>();
  const submitted = new Map<string, Dict<number>>();   // all submissions, incl. excluded (for impossible counts)
  const parentOf: Dict<string> = {};
  for (const r of recs) {
    const u = key(r);
    const sub = submitted.get(u) || {};
    sub[r.role] = (sub[r.role] || 0) + 1;
    submitted.set(u, sub);
    if (r.weight > 0) { if (!groups.has(u)) groups.set(u, []); groups.get(u)!.push(r); }
    if (parentKey) parentOf[u] = parentKey(r);
  }
  const raw = new Map<string, Dict<Combined>>();
  for (const [u, rs] of groups) raw.set(u, rawUnitDims(q, rs, level));

  // reference means = raw means of the parent unit (pooled)
  const ref = new Map<string, Dict<Combined>>();
  if (parentKey) {
    const pg = new Map<string, Scored[]>();
    for (const r of recs) if (r.weight > 0) { const p = parentKey(r); if (!pg.has(p)) pg.set(p, []); pg.get(p)!.push(r); }
    for (const [p, rs] of pg) ref.set(p, rawUnitDims(q, rs, level !== 'teacher' ? (parentLevelName as string) : 'teacher'));
  }

  // between-unit variance per dimension (method of moments)
  const sp = P.shrinkage;
  const tau2: Dict<number> = {};
  for (const dim of Object.keys(q.dimensions)) {
    const ms: number[] = [], vs: number[] = [];
    for (const d of raw.values()) if (d[dim]) { ms.push(d[dim].mean); vs.push(d[dim].var); }
    if (ms.length >= sp.min_units_for_tau2) {
      const mbar = sum(ms) / ms.length;
      const between = sum(ms.map((m) => (m - mbar) ** 2)) / (ms.length - 1);
      tau2[dim] = Math.max(sp.tau2_floor, between - sum(vs) / vs.length);
    } else {
      tau2[dim] = sp.default_tau2;
    }
  }

  const results: Dict<Dict> = {};
  for (const [u, rs] of groups) {
    const dimsOut: Dict = {}, theta: Dict<number> = {}, Bs: Dict<number> = {}, refs: Dict<number | null> = {};
    for (const [dim, st] of Object.entries(raw.get(u)!)) {
      let mRef: number | null = null;
      const pr = parentKey ? ref.get(parentOf[u]) : undefined;
      if (pr && pr[dim]) mRef = pr[dim].mean;
      let B: number, th: number, postVar: number;
      if (mRef === null) { B = 1.0; th = st.mean; postVar = st.var; }
      else { B = tau2[dim] / (tau2[dim] + st.var); th = B * st.mean + (1 - B) * mRef; postVar = B * st.var; }
      const se = Math.sqrt(postVar);
      theta[dim] = th; Bs[dim] = B; refs[dim] = mRef;
      dimsOut[dim] = { raw: pyRound(st.mean, 1), score: pyRound(th, 1), se: pyRound(se, 2), lo: pyRound(th - z * se, 1),
        hi: pyRound(th + z * se, 1), n: st.n, roles: st.roles, shrink_B: pyRound(B, 3), band: band(q, th) };
    }
    const [pillars, index] = indexFrom(q, theta);
    let res: Dict = {
      unit_id: u, level, parent_id: parentOf[u] ?? null, stage: dominantStage(rs),
      n_respondents: { parent: rs.filter((r) => r.role === 'parent').length, student: rs.filter((r) => r.role === 'student').length },
      dimensions: dimsOut, pillars: Object.fromEntries(Object.entries(pillars).map(([k, v]) => [k, pyRound(v, 1)])),
      index: index === null ? null : { score: pyRound(index, 1) }, _theta: theta, _B: Bs, _ref: refs,
    };
    if (level === 'teacher') { res.aspects = teacherAspects(rs, q); res.teacher_indicators = teacherIndicatorShares(q, rs); }
    else { res.indicators = unitIndicators(rs, q); res.equity = equityGaps(q, rs); res.contrast = unitContrast(rs); }
    if (classSizes && ['class', 'school', 'region', 'system'].includes(level)) participation(res, rs, level, classSizes, submitted.get(u) || {});
    const total = res.n_respondents.parent + res.n_respondents.student;
    if (total < P.k_anonymity.unit_min || !Object.keys(dimsOut).length) {
      res = { unit_id: u, level, suppressed: true, reason: 'k_anonymity', stage: res.stage, n_respondents: res.n_respondents };
    } else {
      res.signals = signalsFor(q, rs, level, res.stage, natRefs);
    }
    results[u] = res;
  }
  if (bootstrap) bootstrapIndex(q, groups, results, level, seed);
  tiers(q, results, level === 'class' || level === 'teacher');
  for (const r of Object.values(results)) { delete r._theta; delete r._B; delete r._ref; }
  return results;
}

/** Participation per role (valid responses / roster) and a publication block when submissions exceed the roster. */
function participation(res: Dict, rs: Scored[], level: string, classSizes: Dict<number>, submitted: Dict<number>) {
  const classes = new Set(rs.map((r) => r.unit.class_id));
  const size = sum([...classes].map((c) => classSizes[c] || 0));
  if (!size) return;
  const out: Dict<number> = {};
  for (const role of ['parent', 'student']) {
    const n = res.n_respondents[role];
    if (n) out[role] = pyRound(n / size, 2);
  }
  res.participation = out;
  if (level === 'class' && ['parent', 'student'].some((role) => (submitted[role] || 0) > size)) {
    res.publish_blocked = 'more_responses_than_students';
  } else if (Object.keys(out).length && Math.max(...Object.values(out)) < 0.3) {
    res.representativeness = 'low';
  }
}

function teacherAspects(rs: Scored[], q: Questionnaire): Dict {
  const agg = new Map<string, [number, number][]>();
  for (const r of rs) for (const [a, s] of Object.entries(r.aspects || {})) { if (!agg.has(a)) agg.set(a, []); agg.get(a)!.push([s, r.weight]); }
  const out: Dict = {};
  for (const [a, lst] of agg) {
    const st = wstats(lst.map(([s]) => s), lst.map(([, w]) => w));
    if (st && st.n >= q.params.k_anonymity.teacher_min_students) out[a] = { mean: pyRound(st.mean, 1), n: st.n };
  }
  return out;
}

function unitIndicators(rs: Scored[], q: Questionnaire): Dict {
  const k = q.params.k_anonymity.role_cell;
  const out: Dict = {};
  for (const key of rs.length ? Object.keys(rs[0].ctx.indicators) : []) {
    const vals = rs.filter((r) => r.ctx.indicators[key] !== null && r.ctx.indicators[key] !== undefined)
      .map((r) => [r.ctx.indicators[key] as number, r.weight] as const);
    if (vals.length >= k) {
      const sw = sum(vals.map(([, w]) => w));
      out[key] = { share: pyRound(sum(vals.map(([v, w]) => v * w)) / sw, 3), n: vals.length };
    }
  }
  return out;
}

/** Gender and grade-band gaps per dimension, shown only when every cell passes k-anonymity. */
export function equityGaps(q: Questionnaire, rs: Scored[]): Dict[] {
  const P = q.params;
  const kc = P.k_anonymity.subgroup_cell, kmin = P.k_anonymity.subgroup_unit_min;
  if (rs.length < kmin) return [];
  const splits: [string, (r: Scored) => string | null, string, string][] = [
    ['gender', (r) => r.ctx.gender, 'boy', 'girl'],
    ['grades', (r) => { const g = r.ctx.grade_band; return g === null ? null : g >= 4 ? 'strong' : g <= 2 ? 'struggling' : null; }, 'strong', 'struggling'],
  ];
  const out: Dict[] = [];
  for (const [name, f, a, b] of splits) {
    for (const dim of Object.keys(q.dimensions)) {
      const ga = rs.filter((r) => f(r) === a && dim in r.dims), gb = rs.filter((r) => f(r) === b && dim in r.dims);
      if (ga.length < kc || gb.length < kc) continue;
      const sa = wstats(ga.map((r) => r.dims[dim]), ga.map((r) => r.weight))!;
      const sb = wstats(gb.map((r) => r.dims[dim]), gb.map((r) => r.weight))!;
      const gap = sa.mean - sb.mean;
      const se = Math.sqrt(sa.var / sa.n_eff + sb.var / sb.n_eff);
      const flagged = Math.abs(gap) >= P.equity.flag_gap && Math.abs(gap) > P.equity.z * se;
      out.push({ split: name, dimension: dim, group_a: a, group_b: b, mean_a: pyRound(sa.mean, 1), mean_b: pyRound(sb.mean, 1),
        gap: pyRound(gap, 1), se: pyRound(se, 2), n_a: sa.n, n_b: sb.n, flagged });
    }
  }
  return out;
}

/** k-th smallest of a[0..n) (quickselect; reorders a). */
function select(a: Float64Array, n: number, k: number): number {
  let l = 0, r = n - 1;
  while (l < r) {
    const p = a[(l + r) >> 1];
    let i = l, j = r;
    while (i <= j) {
      while (a[i] < p) i++;
      while (a[j] > p) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) r = j; else if (k >= i) l = i; else return a[k];
  }
  return a[k];
}

const SCRATCH = { buf: new Float64Array(0) };

/** wstats() over typed arrays (same algorithm), for the bootstrap hot loop. xs/ws hold only valid pairs. */
function wstatsArr(xs: Float64Array, ws: Float64Array, n: number): WStats | null {
  if (!n) return null;
  let lo = -Infinity, hi = Infinity;
  if (n >= 20) {
    if (SCRATCH.buf.length < n) SCRATCH.buf = new Float64Array(n * 2);
    const tmp = SCRATCH.buf;
    tmp.set(xs.subarray(0, n));
    lo = select(tmp, n, Math.floor(0.05 * (n - 1)));
    hi = select(tmp, n, Math.ceil(0.95 * (n - 1)));
  }
  let sw = 0, sxw = 0, sww = 0;
  for (let i = 0; i < n; i++) { const x = Math.min(Math.max(xs[i], lo), hi); sw += ws[i]; sxw += x * ws[i]; sww += ws[i] * ws[i]; }
  const mu = sxw / sw;
  let ss = 0;
  for (let i = 0; i < n; i++) { const x = Math.min(Math.max(xs[i], lo), hi); ss += ws[i] * (x - mu) ** 2; }
  const v = (ss / sw) * (n > 1 ? n / (n - 1) : 1.0);
  return { mean: mu, var: Math.max(v, 1.0), n_eff: (sw * sw) / sww, n };
}

/** Percentile CI for the index (resampling respondents within unit and role) + joint rank ranges. */
function bootstrapIndex(q: Questionnaire, groups: Map<string, Scored[]>, results: Dict<Dict>, level: string, seed: number) {
  const reps = q.params.bootstrap_reps;
  const rng = new Rng(seed);
  const dims = Object.keys(q.dimensions);
  const k = q.params.k_anonymity.role_cell;
  const draws = new Map<string, number[]>();
  for (const [u, rs] of groups) {
    const res = results[u];
    if (res.suppressed || !res.index) continue;
    // per role: dimension values (NaN = missing), weights and stages, so a resample is just an index vector
    const roles = new Map<string, { vals: Float64Array[]; w: Float64Array; stage: string[] }>();
    const byRole = new Map<string, Scored[]>();
    for (const r of rs) { if (!byRole.has(r.role)) byRole.set(r.role, []); byRole.get(r.role)!.push(r); }
    let maxN = 0;
    for (const [role, lst] of byRole) {
      maxN = Math.max(maxN, lst.length);
      roles.set(role, {
        vals: dims.map((d) => Float64Array.from(lst, (r) => (r.dims[d] === undefined || r.dims[d] === null ? NaN : r.dims[d]))),
        w: Float64Array.from(lst, (r) => r.weight), stage: lst.map((r) => r.stage),
      });
    }
    const xs = new Float64Array(maxN), ws = new Float64Array(maxN);
    const d: number[] = [];
    for (let i = 0; i < reps; i++) {
      const idx = new Map<string, Int32Array>();
      const stageCount = new Map<string, number>();
      for (const [role, R] of roles) {
        const n = R.w.length, ix = new Int32Array(n);
        for (let j = 0; j < n; j++) ix[j] = rng.randrange(n);
        idx.set(role, ix);
      }
      // dominant stage of the resample, first-seen order as in dominantStage()
      for (const [role, R] of roles) for (const j of idx.get(role)!) stageCount.set(R.stage[j], (stageCount.get(R.stage[j]) || 0) + 1);
      let stage = '', bn = -1;
      for (const [s, c] of stageCount) if (c > bn) { stage = s; bn = c; }
      const th: Dict<number> = {};
      dims.forEach((dim, di) => {
        const perRole: Dict<WStats | null> = { parent: null, student: null };
        for (const [role, R] of roles) {
          let n = 0;
          for (const j of idx.get(role)!) { const x = R.vals[di][j]; if (R.w[j] > 0 && !Number.isNaN(x)) { xs[n] = x; ws[n] = R.w[j]; n++; } }
          perRole[role] = wstatsArr(xs, ws, n);
        }
        const st = combineRoles(q, dim, perRole, stage, k, level);
        if (!st) return;
        const B = res._B[dim] ?? 1.0, m = res._ref[dim];
        th[dim] = m === null || m === undefined ? st.mean : B * st.mean + (1 - B) * m;
      });
      const [, ix] = indexFrom(q, th);
      if (ix !== null) d.push(ix);
    }
    if (d.length >= reps * 0.8) {
      d.sort((a, b) => a - b);
      res.index.lo = pyRound(d[Math.floor(0.05 * (d.length - 1))], 1);
      res.index.hi = pyRound(d[Math.floor(0.95 * (d.length - 1))], 1);
      draws.set(u, d);
    }
  }
  // joint rank ranges (draw j of each unit is independent; rank within each j)
  if (draws.size >= 2) {
    const units = [...draws.keys()];
    const L = Math.min(...[...draws.values()].map((v) => v.length));
    const shuffled = new Map(units.map((u) => [u, rng.sample(draws.get(u)!, L)]));
    const ranks = new Map<string, number[]>(units.map((u) => [u, []]));
    for (let j = 0; j < L; j++) {
      const order = units.slice().sort((a, b) => shuffled.get(b)![j] - shuffled.get(a)![j]);
      order.forEach((u, pos) => ranks.get(u)!.push(pos + 1));
    }
    for (const [u, rk] of ranks) {
      rk.sort((a, b) => a - b);
      results[u].index.rank_range = [rk[Math.floor(0.05 * (L - 1))], rk[Math.floor(0.95 * (L - 1))]];
      results[u].index.of = units.length;
    }
  }
}

/** Classes and teachers are compared only with units of the same stage; schools and regions with all. */
function tiers(q: Questionnaire, results: Dict<Dict>, byStage = false) {
  if (byStage) {
    const g = new Map<string, Dict<Dict>>();
    for (const [u, r] of Object.entries(results)) { const s = r.stage; if (!g.has(s)) g.set(s, {}); g.get(s)![u] = r; }
    for (const x of g.values()) tiers(q, x, false);
    return;
  }
  const tp = q.params.tiers;
  const live = Object.values(results).filter((r) => !r.suppressed && r.index);
  const vals = live.map((r) => r.index.score as number);
  if (vals.length < 2) return;
  const m = sum(vals) / vals.length;
  const sd = Math.sqrt(sum(vals.map((v) => (v - m) ** 2)) / (vals.length - 1));
  const delta = Math.max(tp.delta_min, tp.delta_share_of_sd * sd);
  for (const r of live) {
    const ix = r.index;
    const lo = ix.lo, hi = ix.hi, th = ix.score;
    let t: string;
    if (lo === undefined || lo === null || hi - lo > tp.max_ci_width) t = 'na';
    else if (lo > m + delta) t = th > m + 3 * delta ? '2' : '1';
    else if (hi < m - delta) t = th < m - 3 * delta ? '-2' : '-1';
    else t = '0';
    ix.tier = tp.labels[t];
    ix.tier_code = t;
    ix.reference_mean = pyRound(m, 1);
    ix.band = band(q, th);
  }
}

// =============================================================================== signals (engine.ts only)
/**
 * National reference rates from the same wave, per stage ('I' | 'II' | 'III') and over all stages ('all'), per role:
 * what a class or a teacher is compared with. Classes and teachers use their stage, schools and regions 'all'.
 */
export interface Refs { rates: Dict<Dict<Dict<number>>>; contrast: Dict<number | null> }

const teacherIndicator = (q: Questionnaire, r: Scored, key: string): number | null => {
  const asp = q.teacher_indicators?.[key]?.aspect;
  const s = asp ? r.aspects?.[asp] : undefined;
  return s === undefined || s === null ? null : +(s <= 20);   // month4 map: ≤20 = almost every week or more often
};

function indicatorOf(q: Questionnaire, r: Scored, key: string): number | null {
  if (q.teacher_indicators?.[key]) return teacherIndicator(q, r, key);
  const v = r.ctx.indicators[key];
  return v === undefined ? null : v;
}

export function references(q: Questionnaire, scored: Scored[]): Refs {
  const inc = scored.filter((r) => r.weight > 0);
  const trs = teacherRecords(inc);
  const keys = [...new Set([...(q.params.signals as Dict[]).map((s) => s.indicator).filter(Boolean),
    ...Object.keys(q.indicators || {}), ...Object.keys(q.teacher_indicators || {})])] as string[];
  const rates: Refs['rates'] = {};
  for (const stage of ['all', 'I', 'II', 'III']) {
    rates[stage] = {};
    for (const role of ['all', 'parent', 'student']) {
      const pick = (pool: Scored[]) => pool.filter((r) => (stage === 'all' || r.stage === stage) && (role === 'all' || r.role === role));
      const out: Dict<number> = {};
      for (const k of keys) {
        const pool = q.teacher_indicators?.[k] ? pick(trs) : pick(inc);
        const vals = pool.map((r) => indicatorOf(q, r, k)).filter((v) => v !== null) as number[];
        if (vals.length) out[k] = sum(vals) / vals.length;
      }
      rates[stage][role] = out;
    }
  }
  const contrast: Dict<number | null> = {};
  for (const stage of ['all', 'I', 'II', 'III']) {
    const ds = inc.filter((r) => stage === 'all' || r.stage === stage).map((r) => r.contrast?.symptom_delta).filter((v): v is number => Number.isFinite(v));
    contrast[stage] = ds.length ? sum(ds) / ds.length : null;
  }
  return { rates, contrast };
}

/** Wilson score interval for x of n. */
export function wilson(x: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = x / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

function unitContrast(rs: Scored[]): Dict | null {
  const ds = rs.map((r) => r.contrast?.symptom_delta).filter((v): v is number => Number.isFinite(v));
  if (ds.length < 5) return null;
  const n = ds.length, mean = sum(ds) / n;
  const sd = n > 1 ? Math.sqrt(sum(ds.map((d) => (d - mean) ** 2)) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  const sl = rs.map((r) => r.contrast?.sleep_lost_h).filter((v): v is number => v !== null && v !== undefined);
  const worse = rs.map((r) => r.ctx.indicators.school_worse).filter((v) => v !== null && v !== undefined) as number[];
  return { n, symptom_delta: pyRound(mean, 1), lo: pyRound(mean - 1.96 * se, 1), hi: pyRound(mean + 1.96 * se, 1),
    share_worse: worse.length ? pyRound(sum(worse) / worse.length, 3) : null,
    sleep_lost_h: sl.length >= 5 ? pyRound(sum(sl) / sl.length, 2) : null };
}

function teacherIndicatorShares(q: Questionnaire, rs: Scored[]): Dict {
  const out: Dict = {};
  for (const k of Object.keys(q.teacher_indicators || {})) {
    const vals = rs.map((r) => teacherIndicator(q, r, k)).filter((v) => v !== null) as number[];
    if (vals.length >= q.params.k_anonymity.teacher_min_students) out[k] = { share: pyRound(sum(vals) / vals.length, 3), n: vals.length };
  }
  return out;
}

/**
 * A signal = a unit clearly above the national rate: enough respondents, a meaningful share, and the Wilson 95%
 * lower bound above the national rate. "high" when even the lower bound exceeds rr x national. confirmed_by lists
 * the roles (parents / students) that independently show a rate above their own national rate.
 */
function signalsFor(q: Questionnaire, rs: Scored[], level: string, stage: string, refs: Refs): Dict[] {
  const st = level === 'class' || level === 'teacher' ? stage : 'all';
  const out: Dict[] = [];
  for (const rule of q.params.signals as Dict[]) {
    if (!rule.levels.includes(level)) continue;
    const minN = rule.min_n ?? 10;
    if (rule.kind === 'contrast') {
      const c = unitContrast(rs), ref = refs.contrast[st];
      // the school-weeks effect must be both large and clearly larger than the national one (same stage)
      if (c && c.n >= minN && c.symptom_delta >= rule.min_delta && c.lo > Math.max(ref ?? 0, 0)) {
        out.push({ id: rule.id, kind: 'contrast', severity: ref !== null && c.lo > ref + rule.min_delta ? 'high' : 'elevated', n: c.n,
          delta: c.symptom_delta, ci: [c.lo, c.hi], ref: ref === null ? null : pyRound(ref, 1), share_worse: c.share_worse });
      }
      continue;
    }
    const key = rule.indicator as string;
    const vals = rs.map((r) => [r.role, indicatorOf(q, r, key)] as const).filter(([, v]) => v !== null) as [string, number][];
    const n = vals.length, x = sum(vals.map(([, v]) => v));
    if (n < minN) continue;
    const p = x / n, [lo, hi] = wilson(x, n);
    const p0 = refs.rates[st]?.all?.[key] ?? 0;
    let hit: boolean, severity: string;
    if (rule.kind === 'count') {
      hit = x >= rule.min_count && p >= rule.abs_min;
      severity = rule.severity || 'high';
    } else {
      hit = p >= rule.abs_min && p >= p0 * rule.rr && lo > p0;
      severity = lo >= p0 * rule.rr ? 'high' : 'elevated';
    }
    if (!hit) continue;
    const roles: Dict = {};
    const confirmed: string[] = [];
    for (const role of ['parent', 'student']) {
      const rv = vals.filter(([r0]) => r0 === role);
      if (rv.length < q.params.k_anonymity.role_cell) continue;
      const rp = sum(rv.map(([, v]) => v)) / rv.length, r0 = refs.rates[st]?.[role]?.[key] ?? 0;
      roles[role] = { n: rv.length, rate: pyRound(rp, 3), ref: pyRound(r0, 3) };
      if (rp > r0) confirmed.push(role);
    }
    out.push({ id: rule.id, indicator: key, kind: rule.kind, severity, n, count: x, rate: pyRound(p, 3), ci: [pyRound(lo, 3), pyRound(hi, 3)],
      ref: pyRound(p0, 3), rr: p0 > 0 ? pyRound(p / p0, 2) : null, roles, confirmed_by: confirmed });
  }
  return out;
}

// =============================================================================== campaign detection
/** Units where many responses share an identical answer vector (copy-paste / coordinated filling). */
export function detectCampaigns(scored: Scored[], level = 'class', share = 0.2, minDupes = 5): Dict[] {
  const groups = new Map<string, string[]>();
  for (const r of scored) { const u = unitOf(r, level); if (!groups.has(u)) groups.set(u, []); groups.get(u)!.push(r.answers_vector); }
  const out: Dict[] = [];
  for (const [u, vecs] of groups) {
    const c = new Map<string, number>();
    for (const v of vecs) c.set(v, (c.get(v) || 0) + 1);
    const top = Math.max(...c.values());
    if (top >= minDupes && top / vecs.length >= share) out.push({ unit_id: u, level, identical: top, of: vecs.length });
  }
  return out;
}

export function runWave(q: Questionnaire, responses: Response[],
  opts: { levels?: string[]; seed?: number; classSizes?: Dict<number> | null; bootstrap?: boolean } = {}): Dict {
  const { levels = ['class', 'school', 'region', 'system', 'teacher'], seed = 1, classSizes = null, bootstrap = true } = opts;
  const scored = applyQuality(q, responses.map((r) => scoreRespondent(q, r)));
  const excluded: Dict<number> = {};
  for (const s of scored) if (s.excluded_reason) excluded[s.excluded_reason] = (excluded[s.excluded_reason] || 0) + 1;
  const out: Dict = {
    meta: { responses: responses.length, included: scored.filter((s) => s.weight > 0).length, excluded, questionnaire_version: q.version },
    campaign_alerts: detectCampaigns(scored),
  };
  const refs = references(q, scored);
  out.references = refs;
  for (const lv of levels) out[lv] = aggregate(q, scored, lv, { seed, classSizes, bootstrap, refs });
  return out;
}

// =============================================================================== simulation (demo data)
function pick(q: Questionnaire, v: Variant, target: number, grade: number): number | null {
  if (!v.options) return null;
  let best = 0, bd = 1e9;
  for (let i = 0; i < v.options.length; i++) {
    const s = itemScore(q, v, i, grade);
    if (s === null) continue;
    const d = Math.abs(s - target);
    if (d < bd) { best = i; bd = d; }
  }
  return best;
}

/** School weeks vs vacation: the vacation level is the child's own; a weak school adds symptoms and cuts sleep. */
function simGrid(ans: Answers, v: Variant, rng: Rng, latent: number, grade: number) {
  const [s, w] = v.rows!.map((r) => r.id);
  const n = (v.options || []).length;
  const clamp = (x: number) => Math.min(n - 1, Math.max(0, Math.round(x)));
  if (v.id === 'SC06') {
    const vac = clamp(3 + rng.gauss(0, 0.7) - (grade - 6) / 6);
    ans[w] = vac;
    ans[s] = clamp(vac - Math.max(0, 0.6 + (grade - 4) / 5 - 0.6 * latent + rng.gauss(0, 0.6)));
  } else {
    const vac = clamp(0.8 + rng.gauss(0, 0.7));
    ans[w] = vac;
    ans[s] = clamp(vac + Math.max(0, 0.3 - 0.8 * latent + rng.gauss(0, 0.6)));
  }
}

/** Harmful practices are rare events, more frequent where the school climate is poor. */
function simRare(ans: Answers, v: Variant, rng: Rng, latent: number) {
  if (v.id === 'HP05') ans[v.id] = rng.random() < 0.01 + (latent < -1.5 ? 0.08 : 0) ? 1 : 0;
  else if (v.id === 'HP06') ans[v.id] = rng.random() < 0.04 + (latent < -1 ? 0.12 : 0) ? 1 : 0;
  else ans[v.id] = Math.min(3, Math.max(0, Math.round(-0.8 - 0.9 * latent + rng.gauss(0, 0.8))));
}

function simAnswers(q: Questionnaire, rng: Rng, role: string, grade: number, latent: number, gender: number, token: string): Answers {
  const ans: Answers = {};
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(x)));
  for (let it = 0; it < 3; it++) {   // iterate so that conditional questions see their parents' answers
    for (const v of flow(q, { role, grade, token }, ans, [])) {
      if (v.id in ans || v.type === 'notice' || v.type === 'text' || (v.type === 'grid' && v.rows![0].id in ans)) continue;
      const n = (v.options || []).length;
      if (v.id === 'PR01') ans[v.id] = gender;
      else if (v.id.startsWith('PR02')) ans[v.id] = clamp(1.5 - latent + rng.gauss(0, 0.8), 0, n - 2);
      else if (v.id === 'PR04') ans[v.id] = latent < -0.8 && rng.random() < 0.7 ? 2 : rng.choice([0, 0, 0, 1]);
      else if (v.id === 'PR05') ans[v.id] = latent < 0 ? [0] : [4];
      else if (v.id === 'QC01') ans[v.id] = rng.random() > 0.05 ? 1 : 3;
      else if (v.type === 'multi') ans[v.id] = [rng.randrange(n)];
      else if (v.type === 'grid') simGrid(ans, v, rng, latent, grade);
      else if (v.module === 'HP') simRare(ans, v, rng, latent);
      else if (v.score) ans[v.id] = pick(q, v, 62 + 14 * latent + rng.gauss(0, 12), grade);
      else if (v.options) {
        if (v.id === 'SL01') ans[v.id] = clamp(2 + (grade - 4) / 3 - latent * 0.8 + rng.gauss(0, 0.8), 0, 7);
        else if (v.id === 'SL02') ans[v.id] = clamp(2 + rng.gauss(0, 0.8), 0, 4);
        else if (v.id === 'CD02') ans[v.id] = clamp(-latent * 0.8 + rng.gauss(0, 0.8), 0, 3);
        else ans[v.id] = rng.randrange(n);
      }
    }
  }
  return ans;
}

/** Synthetic wave with known latent quality per school/class/teacher (for the demo portal). */
export function simulate(q: Questionnaire, o: { regions?: number; schoolsPerRegion?: number; classesPerSchool?: number;
  classSize?: number; participationRate?: number; seed?: number; campaignClass?: boolean; speeders?: number } = {}) {
  const { regions = 3, schoolsPerRegion = 6, classesPerSchool = 4, classSize = 20, participationRate = 0.65, seed = 7,
    campaignClass = true, speeders = 0.03 } = o;
  const rng = new Rng(seed);
  const responses: Response[] = [];
  const truth: { school: Dict<number>; teacher: Dict<number>; class_sizes: Dict<number> } = { school: {}, teacher: {}, class_sizes: {} };
  const rosters: Dict<Teacher[]> = {};
  const classGrades: Dict<number> = {};
  const subjects = ['БЕЛ', 'Математика', 'Английски език', 'История', 'Биология', 'Физика', 'ФВС', 'Музика'];
  let rid = 0;
  for (let ri = 0; ri < regions; ri++) {
    const region = `R${ri + 1}`;
    for (let si = 0; si < schoolsPerRegion; si++) {
      const school = `${region}-S${si + 1}`;
      const qs = rng.gauss(0, 1);
      truth.school[school] = qs;
      const teachers: Teacher[] = Array.from({ length: 9 }, (_, i) => ({ teacher_id: `${school}-T${i + 1}`, name: `Учител ${i + 1}`, subject: subjects[i % subjects.length] }));
      for (const t of teachers) truth.teacher[t.teacher_id] = qs * 0.5 + rng.gauss(0, 0.9);
      const grades = rng.sample(Array.from({ length: 12 }, (_, i) => i + 1), classesPerSchool).sort((a, b) => a - b);
      grades.forEach((g, ci) => {
        const cls = `${school}-C${g}`;
        classGrades[cls] = g;
        const qc = qs + rng.gauss(0, 0.5);
        const ct = teachers[ci % teachers.length];
        const classTeachers = [{ ...ct, is_class_teacher: true }, ...teachers.filter((t) => t !== ct).slice(0, 6).map((t) => ({ ...t, is_class_teacher: false }))];
        rosters[cls] = classTeachers;
        const counts: Dict<number> = {};
        const roles = ['parent', ...(g >= q.params.student_min_grade ? ['student'] : [])];
        for (let k = 0; k < classSize; k++) {
          const childLatent = qc + rng.gauss(0, 0.8);
          const gender = rng.choice([0, 1]);
          for (const role of roles) {
            if (rng.random() > participationRate) continue;
            rid += 1;
            const token = `tok${rid}`;
            const assigned = assignTeachers(q, token, role, classTeachers, counts, g);
            for (const t of assigned) counts[t.teacher_id] = (counts[t.teacher_id] || 0) + 1;
            const ans = simAnswers(q, rng, role, g, childLatent + rng.gauss(0, 0.4), gender, token);
            const tans = assigned.map((t) => {
              const lat = truth.teacher[t.teacher_id] + rng.gauss(0, 0.7);
              const ta: Answers = {};
              for (const v of flow(q, { role, grade: g, token }, ans, [t])) {
                if (v.teacher_id) ta[v.id.split('@')[0]] = pick(q, v, 60 + 15 * lat + rng.gauss(0, 8), g);
              }
              return { teacher_id: t.teacher_id, name: t.name, answers: ta };
            });
            let dur = Math.max(30, rng.gauss(role === 'parent' ? 420 : 360, 90));
            if (rng.random() < speeders) dur = rng.uniform(20, 70);
            responses.push({ id: `r${rid}`, token_hash: token, mode: 'closed', role, grade: g, region_id: region, school_id: school,
              class_id: cls, duration_s: Math.round(dur), answers: ans, teachers: tans });
          }
        }
      });
    }
  }
  if (campaignClass && responses.length) {
    const target = responses[0];
    for (let i = 0; i < 12; i++) {
      const clone: Response = structuredClone(target);
      clone.id = `camp${i}`;
      clone.token_hash = `camp${i}`;
      for (const k of Object.keys(clone.answers)) if (typeof clone.answers[k] === 'number') clone.answers[k] = 0;
      responses.push(clone);
    }
  }
  for (const c of Object.keys(rosters)) truth.class_sizes[c] = classSize;
  return { responses, truth, rosters, classGrades };
}
