#!/usr/bin/env node
/**
 * Apply KASY brand package to frontend/icons.
 *
 *   node scripts/apply-brand-package.mjs A   — generated (voice + calendar + speech bubble)
 *   node scripts/apply-brand-package.mjs B   — from kasyico.png + kasyspl.png in brand-assets/source/
 *
 * Env: BRAND_PACKAGE=A|B
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = (process.argv[2] || process.env.BRAND_PACKAGE || 'A').toUpperCase();

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
  if (pkg === 'B') {
    const { runPackageB } = await import('./process-kasy-brand-assets.mjs');
    await runPackageB();
  } else if (pkg === 'A') {
    await run('generate-kasy-brand.mjs');
  } else {
    console.error('Usage: apply-brand-package.mjs [A|B]');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
