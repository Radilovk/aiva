#!/usr/bin/env node
/**
 * Parity check: workers/src/school/engine.ts against the reference school-feedback/engine.py.
 *
 *   node scripts/school-parity.mjs
 *
 * Python simulates a wave and dumps flows, respondent scores and aggregates (bootstrap off: it uses a
 * different PRNG). The TS engine recomputes everything from the same responses and must match. Also checks that
 * the committed browser bundle (frontend/school/lib/sf-engine.js) is built from the current source.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'sf-parity-'));

const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(root, 'school-feedback'))})
import engine as E
q = E.load_questionnaire()
resp, truth, rosters = E.simulate(q, regions=2, schools_per_region=6, seed=11)
flows = []
for r in resp[:300]:
    ts = [{"teacher_id": t["teacher_id"], "name": t["name"]} for t in r["teachers"]]
    flows.append([x["id"] for x in E.flow(q, {"role": r["role"], "grade": r["grade"], "token": r["token_hash"]}, r["answers"], ts)])
scored = E.apply_quality(q, [E.score_respondent(q, r) for r in resp])
agg = {lv: E.aggregate(q, scored, lv, bootstrap=False, class_sizes=truth["class_sizes"]) for lv in ("class", "school", "region", "system", "teacher")}
slim = [{"dims": s["dims"], "weight": s["weight"], "flags": s["flags"], "ctx": s["ctx"], "teachers": s["teachers"]} for s in scored]
json.dump({"responses": resp, "class_sizes": truth["class_sizes"], "flows": flows, "scored": slim, "agg": agg,
           "campaigns": E.detect_campaigns(scored)}, open(sys.argv[1], "w"), ensure_ascii=False)
`;
const fixture = join(tmp, 'fixture.json');
const pyFile = join(tmp, 'dump.py');
writeFileSync(pyFile, py);
execFileSync('python3', [pyFile, fixture], { stdio: 'inherit' });

const esbuild = join(root, 'workers/node_modules/.bin/esbuild');
const bundle = join(tmp, 'engine.mjs');
execFileSync(esbuild, [join(root, 'workers/src/school/engine.ts'), '--bundle', '--format=esm', '--platform=neutral', `--outfile=${bundle}`, '--log-level=warning']);
const E = await import(pathToFileURL(bundle).href);
const F = JSON.parse((await import('node:fs')).readFileSync(fixture, 'utf8'));
const q = E.loadQuestionnaire();

let fails = 0, checks = 0;
const fail = (msg) => { if (fails++ < 25) console.error('✗ ' + msg); };
const close = (a, b, tol, path) => {
  checks++;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > tol) fail(`${path}: py=${a} ts=${b}`); return; }
  if (a === null || b === null || typeof a !== 'object') { if (a !== b && !(a == null && b == null)) fail(`${path}: py=${JSON.stringify(a)} ts=${JSON.stringify(b)}`); return; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) close(a[k], b[k], tol, `${path}.${k}`);
};

// 1. flow
F.flows.forEach((ids, i) => {
  const r = F.responses[i];
  const ts = r.teachers.map((t) => ({ teacher_id: t.teacher_id, name: t.name }));
  const got = E.flow(q, { role: r.role, grade: r.grade, token: r.token_hash }, r.answers, ts).map((x) => x.id);
  checks++;
  if (got.join() !== ids.join()) fail(`flow[${i}] differs`);
});
// 2. respondent scoring + quality
const scored = E.applyQuality(q, F.responses.map((r) => E.scoreRespondent(q, r)));
scored.forEach((s, i) => close(F.scored[i], { dims: s.dims, weight: s.weight, flags: s.flags, ctx: s.ctx, teachers: s.teachers }, 1e-9, `scored[${i}]`));
// 3. aggregates (rounded outputs; float summation order can flip a .x5 tie by one unit in the last digit)
for (const lv of Object.keys(F.agg)) {
  const got = E.aggregate(q, scored, lv, { bootstrap: false, classSizes: F.class_sizes });
  close(F.agg[lv], got, 0.1001, `agg.${lv}`);
}
close(F.campaigns, E.detectCampaigns(scored), 0, 'campaigns');
// 4. bootstrap produces sane intervals
const wave = E.runWave(q, F.responses.slice(0, 600), { classSizes: F.class_sizes });
for (const u of Object.values(wave.school)) {
  if (u.suppressed || !u.index) continue;
  checks++;
  if (!(u.index.lo <= u.index.score && u.index.score <= u.index.hi)) fail(`bootstrap interval ${u.unit_id}: ${JSON.stringify(u.index)}`);
}

console.log(`${checks} checks, ${fails} failures (${F.responses.length} simulated responses)`);
try { execFileSync(process.execPath, [join(root, 'scripts/build-school-engine.mjs'), '--check'], { stdio: 'inherit' }); } catch { fails++; }
process.exit(fails ? 1 : 0);
