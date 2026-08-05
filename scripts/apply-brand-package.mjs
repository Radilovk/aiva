#!/usr/bin/env node
/**
 * Build KASY brand packages and sync the active one to frontend/icons/.
 *
 *   Package A — your uploaded icons + splash (kasyico, kasyspl, kasybutton)
 *   Package B — humanoid art + speech bubble + task calendar overlays
 *
 *   node scripts/apply-brand-package.mjs       — rebuild A+B, keep current active
 *   node scripts/apply-brand-package.mjs A     — rebuild A+B, activate A (default)
 *   node scripts/apply-brand-package.mjs B     — rebuild A+B, activate B
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPackToRoot, readActivePackage } from './lib/brand-pack-sync.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script)], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}

async function main() {
  const arg = (process.argv[2] || process.env.BRAND_PACKAGE || '').toUpperCase();
  const { runPackageA } = await import('./process-kasy-brand-assets.mjs');

  console.log('Building package A (your uploads)…');
  await runPackageA();

  console.log('\nBuilding package B (humanoid + bubble + calendar)…');
  await run('generate-kasy-brand.mjs');

  let active = arg === 'A' || arg === 'B' ? arg : await readActivePackage();
  if (active !== 'A' && active !== 'B') active = 'A';

  console.log(`\nActivating package ${active}…`);
  await copyPackToRoot(active);
  console.log(`\nAll done — active package: ${active}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
