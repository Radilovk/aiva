#!/usr/bin/env node
/**
 * Verify NutriPlan/Icon.md pipeline: 432px adaptive fg, 66.7% safe zone.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  renderAdaptiveForeground,
  renderLegacyLauncher,
  SAFE_ZONE_RATIO,
  APK_ICON_BG,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, '.artifacts', 'icon-preview');
const ICON = join(ROOT, 'frontend', 'icons', 'icon-512.png');
const ADAPTIVE_CANVAS = 432;
const LEGACY_SIZE = 192;

function squircleMaskSvg(size) {
  const r = size * 0.22;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/></svg>`,
  );
}

async function clippedArtPixels(fgBuf, size) {
  const mask = await sharp(squircleMaskSvg(size)).resize(size, size).png().toBuffer();
  const masked = await sharp(fgBuf)
    .composite([{ input: mask, blend: 'dest-in' }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  const orig = await sharp(fgBuf).raw().toBuffer({ resolveWithObject: true });
  let clipped = 0;
  const n = size * size;
  for (let i = 0; i < n; i += 1) {
    const oi = i * 4;
    const oa = orig.data[oi + 3];
    const ma = masked.data[oi + 3];
    if (oa > 20 && ma < 12) clipped += 1;
  }
  return clipped;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const fgBuf = await (await renderAdaptiveForeground(ICON, ADAPTIVE_CANVAS)).png().toBuffer();
  const legacyBuf = await renderLegacyLauncher(ICON, LEGACY_SIZE).png().toBuffer();
  const fgMeta = await sharp(fgBuf).metadata();
  const clipped = await clippedArtPixels(fgBuf, ADAPTIVE_CANVAS);

  await writeFile(join(OUT, 'apk-adaptive-fg-432.png'), fgBuf);
  await writeFile(join(OUT, 'apk-legacy-192.png'), legacyBuf);

  console.log(`Icon preview → ${OUT}/ (bg ${APK_ICON_BG}, safe ${SAFE_ZONE_RATIO.toFixed(3)})`);
  console.log(`Adaptive fg: ${fgMeta.width}×${fgMeta.height} (expect ${ADAPTIVE_CANVAS})`);
  console.log(`Squircle clipped opaque pixels: ${clipped}`);

  if (fgMeta.width !== ADAPTIVE_CANVAS || fgMeta.height !== ADAPTIVE_CANVAS) {
    throw new Error(`Adaptive foreground must be ${ADAPTIVE_CANVAS}px, got ${fgMeta.width}`);
  }
  if (clipped > 0) {
    throw new Error(`Foreground clipped by squircle (${clipped}px)`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
