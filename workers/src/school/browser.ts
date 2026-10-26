/**
 * Browser bundle for the operator console: the same engine the parity test checks against engine.py.
 * Built into frontend/school/lib/sf-engine.js by `node scripts/build-school-engine.mjs` (exposes window.SFEngine).
 */
export { loadQuestionnaire, runWave, simulate } from './engine';
export { unitRows, LEVELS } from './publish';
