#!/usr/bin/env node
/**
 * Verify maskable launcher icon: white full-bleed bg, robot in 72dp safe zone.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  renderApkForeground,
  renderApkLegacy,
  APK_FOREGROUND_FILL,
  APK_ICON_BG,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, '.artifacts', 'icon-preview');
const ICON = join(ROOT, 'frontend', 'icons', 'icon-512.png');
const SIZE = 192;

function squircleMaskSvg(size) {
  const r = size * 0.22;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/></svg>`,
  );
}

function isArtPixel(r, g, b, a) {
  if (a < 20) return false;
  return !(r > 240 && g > 240 && b > 240);
}

async function clippedArtPixels(fgBuf) {
  const mask = await sharp(squircleMaskSvg(SIZE)).resize(SIZE, SIZE).png().toBuffer();
  const masked = await sharp(fgBuf)
    .composite([{ input: mask, blend: 'dest-in' }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  const orig = await sharp(fgBuf).raw().toBuffer({ resolveWithObject: true });
  let clipped = 0;
  const n = SIZE * SIZE;
  for (let i = 0; i < n; i += 1) {
    const oi = i * 4;
    const or = orig.data[oi];
    const og = orig.data[oi + 1];
    const ob = orig.data[oi + 2];
    const oa = orig.data[oi + 3];
    const ma = masked.data[oi + 3];
    if (isArtPixel(or, og, ob, oa) && ma < 12) clipped += 1;
  }
  return clipped;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const fgBuf = await (await renderApkForeground(ICON, SIZE)).png().toBuffer();
  const legacyBuf = await (await renderApkLegacy(ICON, SIZE)).png().toBuffer();
  const clipped = await clippedArtPixels(fgBuf);
  await writeFile(join(OUT, 'apk-foreground.png'), fgBuf);
  await writeFile(join(OUT, 'apk-legacy-icon.png'), legacyBuf);
  console.log(`Icon preview → ${OUT}/ (bg ${APK_ICON_BG}, fill ${APK_FOREGROUND_FILL.toFixed(3)})`);
  console.log(`Squircle clipped art pixels: ${clipped}`);
  if (clipped > 0) {
    throw new Error(`Art clipped by squircle mask (${clipped}px)`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
