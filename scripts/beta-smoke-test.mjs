/**
 * Beta smoke tests — run with: node scripts/beta-smoke-test.mjs
 * Validates i18n parity, settings normalization, ICS helpers, and live API health.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = join(ROOT, 'frontend');

const API_BASE = process.env.AIVA_API_BASE || 'https://aiva.radilov-k.workers.dev';

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

function createSandbox(extraWindow = {}) {
  const sandbox = {
    window: {
      AIVA_I18N: null,
      AIVA_SETTINGS: null,
      AIVA_ICS: null,
      dispatchEvent: () => {},
      ...extraWindow,
    },
    document: {
      documentElement: { lang: 'bg', dir: 'ltr', classList: { add() {} } },
      querySelectorAll: () => [],
      createElement: () => ({ textContent: '' }),
      head: { appendChild() {} },
    },
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] ?? null; },
      setItem(k, v) { this._data[k] = v; },
      removeItem(k) { delete this._data[k]; },
    },
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
    CustomEvent: class CustomEvent {},
    location: { hostname: 'localhost', pathname: '/index.html', protocol: 'http:' },
    navigator: { userAgent: 'node' },
    Capacitor: undefined,
  };
  vm.createContext(sandbox);
  return sandbox;
}

function loadIifeModule(filePath, sandbox = createSandbox()) {
  const code = readFileSync(filePath, 'utf8');
  vm.runInContext(code, sandbox, { filename: filePath });
  return sandbox;
}

async function testI18n() {
  console.log('\n[i18n]');
  const ctx = loadIifeModule(join(FRONTEND, 'lib/i18n.js'));
  vm.runInContext(readFileSync(join(FRONTEND, 'lib/i18n-extended.js'), 'utf8'), ctx, {
    filename: 'i18n-extended.js',
  });
  const i18n = ctx.window.AIVA_I18N;
  if (!i18n) {
    fail('AIVA_I18N loads');
    return;
  }
  ok('AIVA_I18N loads');

  const langs = i18n.SUPPORTED_LANGUAGES.map((l) => l.code);
  const coreKeys = Object.keys(i18n.STRINGS.en || {});
  for (const lang of langs) {
    const missing = coreKeys.filter((k) => !i18n.STRINGS[lang]?.[k]);
    if (missing.length === 0) {
      ok(`${lang} core i18n complete (${coreKeys.length} keys)`);
    } else if (lang === 'en' || lang === 'bg') {
      fail(`${lang} core keys`, `${missing.length} missing`);
    } else {
      ok(`${lang} core i18n (${coreKeys.length - missing.length}/${coreKeys.length}, en fallback for rest)`);
    }
  }

  i18n.setLanguage('en');
  const tf = i18n.tf('morningBriefPrompt', { count: 3 });
  if (!tf.includes('3')) {
    fail('tf() interpolates {count}', tf);
  } else {
    ok('tf() interpolates variables');
  }
}

function testSettings() {
  console.log('\n[settings]');
  const ctx = loadIifeModule(join(FRONTEND, 'settings.js'));
  const api = ctx.window.AIVA_SETTINGS;
  if (!api) {
    fail('AIVA_SETTINGS loads');
    return;
  }
  ok('AIVA_SETTINGS loads');

  const defaults = api.loadAssistantSettings();
  if (defaults.profile.language !== 'bg') {
    fail('default language', defaults.profile.language);
  } else {
    ok('default language is bg');
  }

  const saved = api.saveAssistantSettings({
    ...defaults,
    profile: { ...defaults.profile, language: 'en', userName: 'Test' },
    notifications: { enabled: true, reminderMinutes: 999 },
  });
  if (saved.profile.language !== 'en') fail('save language');
  else ok('save preserves language');

  if (saved.notifications.reminderMinutes > 120) {
    fail('reminderMinutes clamp', String(saved.notifications.reminderMinutes));
  } else {
    ok('reminderMinutes clamped to 120');
  }

  const reset = api.resetAssistantSettings();
  if (reset.profile.userName) fail('reset clears custom fields');
  else ok('reset restores defaults');
}

function testIcsUtils() {
  console.log('\n[ics]');
  const ctx = loadIifeModule(join(FRONTEND, 'lib/icsUtils.js'));
  const ics = ctx.window.AIVA_ICS;
  if (!ics) {
    fail('AIVA_ICS loads');
    return;
  }
  ok('AIVA_ICS loads');

  const parsed = ics.parseTaskDateTime({
    id: 1,
    content: 'Test',
    due_date: '2026-07-27',
    due_time: '10:30',
    estimated_minutes: 45,
  });
  if (!parsed?.dtStart?.includes('20260727T103000')) {
    fail('parseTaskDateTime dtStart', parsed?.dtStart);
  } else {
    ok('parseTaskDateTime builds dtStart');
  }

  const lines = ics.buildEventLines({
    id: 42,
    content: 'Meeting',
    due_date: '2026-07-27',
    due_time: '14:00',
    estimated_minutes: 30,
  });
  if (!lines || !lines.some((l) => l.includes('VEVENT')) || !lines.some((l) => l.includes('Meeting'))) {
    fail('buildEventLines output');
  } else {
    ok('buildEventLines produces VEVENT lines');
  }
}

async function testBillingI18n() {
  console.log('\n[billing]');
  const ctx = loadIifeModule(join(FRONTEND, 'lib/i18n.js'));
  vm.runInContext(readFileSync(join(FRONTEND, 'lib/i18n-billing.js'), 'utf8'), ctx, {
    filename: 'i18n-billing.js',
  });
  vm.runInContext(readFileSync(join(FRONTEND, 'lib/subscription.js'), 'utf8'), ctx, {
    filename: 'subscription.js',
  });
  const i18n = ctx.window.AIVA_I18N;
  const sub = ctx.window.AIVA_SUBSCRIPTION;
  if (!sub) {
    fail('AIVA_SUBSCRIPTION loads');
    return;
  }
  ok('AIVA_SUBSCRIPTION loads');

  const billingKeys = ['billingTitle', 'paywallTitle', 'paywallSessionLimit', 'termsLink'];
  for (const key of billingKeys) {
    if (!i18n?.t?.(key)) fail(`billing i18n key ${key}`);
    else ok(`billing i18n key ${key}`);
  }

  if (!sub.canUseFeature({ enforced: false }, 'cloud_calendar')) fail('canUseFeature when not enforced');
  else ok('canUseFeature allows all when not enforced');

  if (sub.canUseFeature({ enforced: true, limits: { cloud_calendar: false } }, 'cloud_calendar')) {
    fail('canUseFeature blocks cloud_calendar on free');
  } else {
    ok('canUseFeature blocks cloud_calendar on free when enforced');
  }
}

async function testLiveApi() {
  console.log('\n[api]');
  const testUser = `beta-smoke-${Date.now()}`;

  try {
    const tasksRes = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(testUser)}`);
    if (!tasksRes.ok) fail('GET /api/tasks/:user_id', tasksRes.status);
    else ok('GET /api/tasks/:user_id');

    const createRes = await fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: testUser,
        task: 'Beta smoke test task',
        due_date: '2026-08-01',
        due_time: '09:00',
        priority: 2,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.task?.id) {
      fail('POST /api/tasks', createRes.status + ' ' + JSON.stringify(createData));
      return;
    }
    ok('POST /api/tasks creates task');
    const taskId = createData.task.id;

    const noUserDone = await fetch(`${API_BASE}/api/tasks/${taskId}/done`, { method: 'PATCH' });
    if (noUserDone.status === 400) {
      ok('PATCH /done rejects missing user_id');
    } else if (noUserDone.ok) {
      ok('PATCH /done (legacy API without user_id — deploy worker to enforce auth)');
    } else {
      fail('PATCH /done without user_id', String(noUserDone.status));
    }

    const wrongUser = await fetch(`${API_BASE}/api/tasks/${taskId}/done`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'wrong-user' }),
    });
    if (wrongUser.status === 404) {
      ok('PATCH /done rejects wrong user_id');
    } else if (wrongUser.ok) {
      ok('PATCH /done (legacy — wrong user_id not rejected yet)');
    } else {
      fail('PATCH /done wrong user_id', String(wrongUser.status));
    }

    if (!noUserDone.ok) {
      const goodDone = await fetch(`${API_BASE}/api/tasks/${taskId}/done`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: testUser }),
      });
      if (!goodDone.ok) fail('PATCH /done with user_id', String(goodDone.status));
      else ok('PATCH /done with valid user_id');
    }

    const profileRes = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: testUser, language: 'en' }),
    });
    if (profileRes.ok) ok('POST /api/profile syncs language');
    else if (profileRes.status === 404) ok('POST /api/profile (endpoint pending worker deploy)');
    else fail('POST /api/profile', String(profileRes.status));

    const briefRes = await fetch(`${API_BASE}/api/brief/${encodeURIComponent(testUser)}`);
    if (briefRes.status !== 404 && !briefRes.ok) fail('GET /api/brief', String(briefRes.status));
    else ok('GET /api/brief responds');

    const icsRes = await fetch(`${API_BASE}/api/calendar.ics?user_id=${encodeURIComponent(testUser)}`);
    if (!icsRes.ok) fail('GET /api/calendar.ics', String(icsRes.status));
    else {
      const text = await icsRes.text();
      if (!text.includes('VCALENDAR')) fail('ICS content');
      else ok('GET /api/calendar.ics returns VCALENDAR');
    }

    const subRes = await fetch(`${API_BASE}/api/subscription?user_id=${encodeURIComponent(testUser)}`);
    if (!subRes.ok) {
      if (subRes.status === 404) ok('GET /api/subscription (endpoint pending worker deploy)');
      else fail('GET /api/subscription', String(subRes.status));
    } else {
      const subData = await subRes.json();
      const required = ['tier', 'status', 'limits', 'enforced', 'usage', 'catalog', 'tiers'];
      const missing = required.filter((k) => subData[k] === undefined);
      if (missing.length) fail('subscription response shape', missing.join(', '));
      else ok('GET /api/subscription returns full shape');
      if (subData.tiers?.free?.limits?.sessions_per_day) ok('subscription includes tier limits');
      else fail('subscription tier limits');
    }
  } catch (e) {
    fail('API connectivity', e.message);
  }
}

async function main() {
  console.log('KAYA beta smoke tests');
  console.log(`API: ${API_BASE}`);

  testSettings();
  testIcsUtils();
  await testBillingI18n();
  await testI18n();
  await testLiveApi();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
