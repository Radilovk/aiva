/**
 * Device Actions unit tests — run with: node scripts/test-device-actions.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = join(ROOT, 'frontend');

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

function createSandbox(extra = {}) {
  const nativeCalls = [];
  const sandbox = {
    window: {
      AIVA_SETTINGS: {
        loadAssistantSettings: () => ({
          deviceActions: { enabled: true },
          profile: { language: 'bg' },
        }),
      },
      AIVA_NOTIFIER: {
        scheduleAt: async () => true,
      },
      Capacitor: {
        getPlatform: () => 'android',
        Plugins: {
          AivaActions: {
            navigateTo: async (p) => {
              nativeCalls.push(['navigateTo', p]);
              return { ok: true, method: 'google_navigation', oem: 'stock' };
            },
            openApp: async (p) => {
              nativeCalls.push(['openApp', p]);
              return { ok: true, packageName: p.packageNames?.[0] };
            },
            shareText: async (p) => {
              nativeCalls.push(['shareText', p]);
              return { ok: true, method: 'share_targeted' };
            },
            composeSms: async (p) => {
              nativeCalls.push(['composeSms', p]);
              return { ok: true, phone: p.phone };
            },
            runDiagnostics: async () => ({
              ok: true,
              oem: 'xiaomi',
              checks: [{ name: 'google_maps', ok: true }],
            }),
          },
        },
      },
      open: () => {},
      ...extra,
    },
    document: {},
    console,
    FunctionCallDefinition: class FunctionCallDefinition {
      constructor(name, description, schema, required) {
        this.name = name;
        this.description = description;
        this.schema = schema;
        this.required = required;
      }
      functionToCall() {
        return 'pending';
      }
    },
    navigator: { share: null, clipboard: null },
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { href: '' },
  };
  vm.createContext(sandbox);
  sandbox._nativeCalls = nativeCalls;
  return sandbox;
}

function loadDeviceActions(sandbox = createSandbox()) {
  const code = readFileSync(join(FRONTEND, 'lib/deviceActions.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'deviceActions.js' });
  return sandbox.window.AIVA_DEVICE_ACTIONS;
}

function testCatalog() {
  console.log('\n[catalog]');
  const api = loadDeviceActions();
  if (!api) {
    fail('AIVA_DEVICE_ACTIONS loads');
    return;
  }
  ok('AIVA_DEVICE_ACTIONS loads');

  const maps = api.APP_CATALOG.maps;
  if (!maps?.packageNames?.includes('com.huawei.maps.app')) {
    fail('maps includes Petal Maps fallback');
  } else {
    ok('maps includes Petal Maps fallback');
  }

  if (!api.APP_CATALOG.camera?.packageNames?.includes('com.miui.camera')) {
    fail('camera includes MIUI package');
  } else {
    ok('camera includes MIUI package');
  }

  if (!api.APP_CATALOG.petal_maps) {
    fail('petal_maps alias exists');
  } else {
    ok('petal_maps alias exists');
  }
}

async function testNativeBridge(sandbox) {
  console.log('\n[native bridge]');
  const api = loadDeviceActions(sandbox);

  const nav = await api.navigate('София', 'drive');
  if (!nav.ok) fail('navigate returns ok');
  else ok('navigate returns ok');

  const navCall = sandbox._nativeCalls.find((c) => c[0] === 'navigateTo');
  if (!navCall || navCall[1].language !== 'bg') {
    fail('navigate passes user language', JSON.stringify(navCall?.[1]));
  } else {
    ok('navigate passes user language');
  }

  const open = await api.openApp('maps');
  if (!open.ok) fail('openApp maps');
  else ok('openApp maps');

  const openCall = sandbox._nativeCalls.find((c) => c[0] === 'openApp');
  if (!openCall?.[1]?.packageNames?.includes('com.google.android.apps.maps')) {
    fail('openApp sends packageNames array');
  } else {
    ok('openApp sends packageNames array');
  }

  const sms = await api.composeSms('0888123456', 'test');
  if (!sms.ok) fail('composeSms');
  else ok('composeSms');

  const diag = await api.runDiagnostics();
  if (!diag.ok || diag.oem !== 'xiaomi') fail('runDiagnostics', JSON.stringify(diag));
  else ok('runDiagnostics');
}

function testGeminiTools() {
  console.log('\n[gemini tools]');
  const api = loadDeviceActions();
  const tools = api.getGeminiTools();
  if (tools.length !== 12) {
    fail('12 gemini tools', String(tools.length));
  } else {
    ok('12 gemini tools');
  }

  const names = tools.map((t) => t.name);
  const required = [
    'device_navigate',
    'device_open_app',
    'device_share_text',
    'device_compose_sms',
    'device_schedule_reminder',
  ];
  for (const name of required) {
    if (!names.includes(name)) fail(`tool ${name}`);
    else ok(`tool ${name}`);
  }
}

async function testHandleToolDisabled() {
  console.log('\n[disabled]');
  const sandbox = createSandbox();
  sandbox.window.AIVA_SETTINGS.loadAssistantSettings = () => ({
    deviceActions: { enabled: false },
    profile: { language: 'en' },
  });
  const api = loadDeviceActions(sandbox);

  const res = await api.handleTool('device_navigate', { destination: 'test' });
  if (res.ok || res.error !== 'device actions disabled in settings') {
    fail('handleTool respects disabled flag', JSON.stringify(res));
  } else {
    ok('handleTool respects disabled flag');
  }
}

async function testListTestActions() {
  console.log('\n[test actions]');
  const api = loadDeviceActions();
  const actions = api.listTestActions();
  if (!actions.some((a) => a.id === 'diagnostics')) {
    fail('diagnostics in test panel');
  } else {
    ok('diagnostics in test panel');
  }
  if (actions.length < 10) fail('test actions count', String(actions.length));
  else ok(`${actions.length} test actions`);
}

async function main() {
  console.log('KASY device actions tests');
  const sandbox = createSandbox();

  testCatalog();
  await testNativeBridge(sandbox);
  testGeminiTools();
  await testHandleToolDisabled();
  await testListTestActions();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
