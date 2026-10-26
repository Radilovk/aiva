/**
 * Turns a computed wave into the rows the Worker stores (sf_units), so the Worker never parses or reshapes
 * results itself. Runs where the wave is computed: in the operator's browser (frontend/school/lib/sf-engine.js),
 * which keeps every Worker request far below the 10 ms CPU of the free plan.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Dict<T = any> = Record<string, T>;

export const LEVELS = ['system', 'region', 'school', 'class', 'teacher'] as const;

export interface UnitRow {
  level: string; unit_id: string; parent_id: string | null; suppressed: 0 | 1; score: number | null; tier: string | null;
  /** for the inspectorate scope (РУО sees its region) */
  region_id: string | null;
  /** signals live in their own column: only inspectors, the school and the teacher concerned may read them */
  n_signals: number; signals: string;
  /** what list endpoints return (without names, which the Worker joins in SQL) */
  summary: string;
  /** what the unit page returns (+ free-text themes for school, region, system) */
  data: string;
}

/** One exported response: its unit and the redacted free-text themes recorded at submit. */
export interface ThemeRef { region_id: string; school_id: string; themes: string[] }

function summary(level: string, x: Dict): Dict {
  if (x.publish_blocked) return { unit_id: x.unit_id, level, withheld: x.publish_blocked };
  return {
    unit_id: x.unit_id, parent_id: x.parent_id ?? null, stage: x.stage, n_respondents: x.n_respondents, index: x.index,
    pillars: x.pillars, representativeness: x.representativeness ?? 'ok',
    tc: x.dimensions?.TC ? { score: x.dimensions.TC.score, lo: x.dimensions.TC.lo, hi: x.dimensions.TC.hi } : undefined,
  };
}

function themeCounts(refs: ThemeRef[]): Dict {
  const counts: Dict<number> = {};
  let n = 0;
  for (const r of refs) {
    if (!r.themes) continue;
    n += 1;
    for (const t of r.themes) counts[t] = (counts[t] || 0) + 1;
  }
  return { respondents_with_text: n, themes: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])) };
}

export function unitRows(res: Dict, refs: ThemeRef[]): UnitRow[] {
  const by: Dict<Map<string, ThemeRef[]>> = { school: new Map(), region: new Map(), system: new Map() };
  const add = (lv: string, u: string, r: ThemeRef) => { if (!by[lv].has(u)) by[lv].set(u, []); by[lv].get(u)!.push(r); };
  for (const r of refs) { add('school', r.school_id, r); add('region', r.region_id, r); add('system', 'BG', r); }
  const regionOfSchool = new Map(refs.map((r) => [r.school_id, r.region_id]));
  const schoolOfClass = new Map(Object.values((res.class || {}) as Dict<Dict>).map((u) => [u.unit_id, u.parent_id]));
  const regionOf = (level: string, unit: Dict): string | null => {
    if (level === 'region') return unit.unit_id;
    if (level === 'school') return unit.parent_id ?? regionOfSchool.get(unit.unit_id) ?? null;
    if (level === 'class' || level === 'teacher') return regionOfSchool.get(unit.parent_id ?? schoolOfClass.get(unit.unit_id)) ?? null;
    return null;
  };
  const out: UnitRow[] = [];
  for (const level of LEVELS) {
    for (const [uid, unit] of Object.entries((res[level] || {}) as Dict<Dict>)) {
      const rs = by[level]?.get(uid);
      const { signals = [], ...rest } = unit;
      const data = rs ? { ...rest, themes: themeCounts(rs) } : rest;
      out.push({
        level, unit_id: uid, parent_id: unit.parent_id ?? null, suppressed: unit.suppressed ? 1 : 0,
        score: unit.index?.score ?? unit.dimensions?.TC?.score ?? null, tier: unit.index?.tier_code ?? null,
        region_id: regionOf(level, unit), n_signals: signals.length, signals: JSON.stringify(signals),
        summary: JSON.stringify(summary(level, unit)), data: JSON.stringify(data),
      });
    }
  }
  return out;
}
