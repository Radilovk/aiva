/**
 * Session end + device time context tests — node scripts/test-session-end.mjs
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

function loadModules() {
  const sandbox = {
    window: {},
    console,
    Intl,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(FRONTEND, 'lib/i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' });
  vm.runInContext(readFileSync(join(FRONTEND, 'lib/sessionEnd.js'), 'utf8'), sandbox, { filename: 'sessionEnd.js' });
  vm.runInContext(readFileSync(join(FRONTEND, 'settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
  return sandbox.window;
}

function testFarewellDetection(api) {
  console.log('\n[farewell detection]');
  const cases = [
    ['Благодаря! Оставам на разположение — чао и до скоро.', true],
    ['See you soon and have a great day!', true],
    ['Hasta luego, que tengas un buen día.', true],
    ['Au revoir et bonne journée.', true],
    ['До свидания, буду на связи.', true],
    ['再见，有需要再联系。', true],
    ['Какво мислиш за задачата утре?', false],
    ['Thanks for the info. What about the next task?', false],
  ];
  for (const [text, expected] of cases) {
    const got = api.looksLikeAssistantFarewell(text);
    if (got === expected) ok(`farewell: ${text.slice(0, 40)}…`);
    else fail(`farewell: ${text.slice(0, 40)}`, `expected ${expected}, got ${got}`);
  }
}

function testUserGoodbye(api) {
  console.log('\n[user goodbye]');
  const cases = [
    ['чао', true],
    ['bye, thanks', true],
    ['не благодаря', true],
    ['добави задача за утре', false],
  ];
  for (const [text, expected] of cases) {
    const got = api.looksLikeUserGoodbye(text);
    if (got === expected) ok(`user: ${text}`);
    else fail(`user: ${text}`, `expected ${expected}, got ${got}`);
  }
}

function testLocalizedInstructions(win) {
  console.log('\n[instructions]');
  const langs = ['bg', 'en', 'es', 'fr', 'de', 'ru', 'hi', 'zh', 'ar'];
  for (const lang of langs) {
    const block = win.AIVA_SESSION_END.getSessionEndInstructions(lang);
    if (!block.includes('end_session')) fail(`${lang} session end block`);
    else ok(`${lang} session end block`);
    const dt = win.AIVA_SESSION_END.buildDeviceDateTimeContext(lang);
    if (!dt.includes('isoDate') && !dt.match(/\d{4}-\d{2}-\d{2}/)) {
      fail(`${lang} datetime context`, dt.slice(0, 60));
    } else {
      ok(`${lang} datetime context`);
    }
  }

  const built = win.AIVA_SETTINGS.buildSessionInstructions(
    'Base prompt.',
    { language: 'en', userName: 'Test' },
    ''
  );
  if (!built.includes('end_session') || !built.match(/\d{4}-\d{2}-\d{2}/)) {
    fail('buildSessionInstructions merges time + end block');
  } else {
    ok('buildSessionInstructions merges time + end block');
  }
}

const win = loadModules();
testFarewellDetection(win.AIVA_SESSION_END);
testUserGoodbye(win.AIVA_SESSION_END);
testLocalizedInstructions(win);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
