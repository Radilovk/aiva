/**
 * Assistant memory tests — node scripts/test-assistant-memory.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(__dirname, '..', 'frontend');

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fail(name, detail) {
  failed++;
  console.error(`  ✗ ${name}`);
  if (detail) console.error(`    ${detail}`);
}

  function loadMemory() {
  const store = { _d: {} };
  const sandbox = {
    window: {
      AIVA_CONFIG: { API_BASE: 'https://example.test' },
      localStorage: {
        getItem(k) { return store._d[k] ?? null; },
        setItem(k, v) { store._d[k] = v; },
      },
      fetch: async () => ({ ok: true, json: async () => ({ entries: [], updated_at: null }) }),
    },
    console,
    FunctionCallDefinition: class FunctionCallDefinition {
      constructor(name) { this.name = name; }
      functionToCall() { return 'pending'; }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(FRONTEND, 'lib/assistantMemory.js'), 'utf8'), sandbox);
  return sandbox.window.AIVA_MEMORY;
}

async function main() {
  console.log('KASY assistant memory tests');
  const mem = loadMemory();
  if (!mem) {
    fail('AIVA_MEMORY loads');
    process.exit(1);
  }
  ok('AIVA_MEMORY loads');

  const save = await mem.upsertEntry({ key: 'coffee', content: 'Prefers espresso', category: 'preference' });
  if (!save.ok) fail('memory_save');
  else ok('memory_save');

  const list = await mem.listEntries('preference');
  if (!list.ok || list.count < 1) fail('memory_list');
  else ok('memory_list');

  const update = await mem.upsertEntry({ key: 'coffee', content: 'Prefers double espresso', category: 'preference' });
  if (!update.ok || update.action !== 'updated') fail('memory_update');
  else ok('memory_update');

  const del = await mem.deleteEntry({ key: 'coffee' });
  if (!del.ok) fail('memory_delete');
  else ok('memory_delete');

  const tools = mem.getGeminiTools();
  if (tools.length !== 3) fail('gemini tools count', String(tools.length));
  else ok('3 memory gemini tools');

  const section = await mem.buildPromptSection();
  if (!section.includes('ПОСТОЯННА ПАМЕТ')) fail('prompt section');
  else ok('prompt section');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
