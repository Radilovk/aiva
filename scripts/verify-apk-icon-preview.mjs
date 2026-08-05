#!/usr/bin/env node
/**
 * Verify the circular launcher icon before building the APK:
 * corners transparent (round shape), disc opaque, artwork inside the disc.
 * Writes a preview to .artifacts/icon-preview/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  renderApkCircle,
  resolveMasterIcon,
  APK_CIRCLE_FILL,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, '.artifacts', 'icon-preview');
const SIZE = 192; // xxxhdpi launcher bitmap

async function main() {
  await mkdir(OUT, { recursive: true });
  const master = await resolveMasterIcon();
  const iconBuf = await (await renderApkCircle(master, SIZE)).png().toBuffer();
  await writeFile(join(OUT, 'apk-launcher-icon.png'), iconBuf);

  const { data, info } = await sharp(iconBuf).raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
  const c = SIZE / 2;
  const rim = Math.floor(SIZE * 0.02);

  const checks = [
    ['canvas is 192×192', info.width === SIZE && info.height === SIZE],
    ['corners transparent (round icon)',
      alphaAt(0, 0) === 0 && alphaAt(SIZE - 1, 0) === 0
      && alphaAt(0, SIZE - 1) === 0 && alphaAt(SIZE - 1, SIZE - 1) === 0],
    ['disc opaque at center', alphaAt(c, c) === 255],
    ['disc opaque at mid-edges',
      alphaAt(c, rim) > 200 && alphaAt(c, SIZE - 1 - rim) > 200
      && alphaAt(rim, c) > 200 && alphaAt(SIZE - 1 - rim, c) > 200],
  ];

  console.log(`Icon preview → ${OUT}/ (circular, art ${Math.round(APK_CIRCLE_FILL * 100)}% of disc)`);
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}`);
    if (!ok) failed += 1;
  }
  if (failed > 0) throw new Error(`${failed} icon check(s) failed`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
