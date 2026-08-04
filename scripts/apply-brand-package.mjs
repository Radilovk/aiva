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
  const pkg = (process.argv[2] || process.env.BRAND_PACKAGE || '').toUpperCase();
  if (pkg === 'B') {
    const { runPackageB } = await import('./process-kasy-brand-assets.mjs');
    await runPackageB();
    return;
  }
  if (pkg === 'A') {
    await run('generate-kasy-brand.mjs');
    return;
  }
  // Auto: prefer Package B when user art is present
  const { existsSync } = await import('node:fs');
  const bIcon = ['brand-assets/source/kasyico.png', 'kasyico.png'].find((p) =>
    existsSync(join(ROOT, p))
  );
  if (bIcon) {
    console.log(`Found ${bIcon} — applying Package B`);
    const { runPackageB } = await import('./process-kasy-brand-assets.mjs');
    await runPackageB();
  } else {
    await run('generate-kasy-brand.mjs');
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
