#!/usr/bin/env node
/**
 * Visual verification: PWA reference vs APK launcher after squircle mask.
 * Fails CI if headset art is clipped by the simulated mask.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderApkForeground, APK_ICON_FILL } from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, '.artifacts', 'icon-preview');
const ICON = join(ROOT, 'frontend', 'icons', 'icon-512.png');
const BG = { r: 5, g: 5, b: 8, alpha: 255 };
const SIZE = 192;

function squircleMaskSvg(size) {
  const r = size * 0.22;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/></svg>`,
  );
}

async function pwaReference() {
  const resized = await sharp(ICON)
    .resize(SIZE, SIZE, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BG } })
    .composite([{
      input: resized,
      left: Math.floor((SIZE - meta.width) / 2),
      top: Math.floor((SIZE - meta.height) / 2),
    }])
    .png()
    .toBuffer();
}

async function maskedApkIcon() {
  const fgBuf = await renderApkForeground(ICON, SIZE).then((p) => p.png().toBuffer());
  const mask = await sharp(squircleMaskSvg(SIZE)).resize(SIZE, SIZE).png().toBuffer();
  const masked = await sharp(fgBuf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return masked;
}

function isBackground(r, g, b, a) {
  return a > 200 && r < 20 && g < 20 && b < 20;
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
    if (oa > 12 && !isBackground(or, og, ob, oa) && ma < 12) clipped += 1;
  }
  return clipped;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const fgBuf = await renderApkForeground(ICON, SIZE).then((p) => p.png().toBuffer());
  const clipped = await clippedArtPixels(fgBuf);

  await writeFile(join(OUT, 'pwa-reference.png'), await pwaReference());
  await writeFile(join(OUT, 'apk-flat-icon.png'), fgBuf);
  await writeFile(join(OUT, 'apk-squircle-masked.png'), await maskedApkIcon());

  console.log(`Icon previews → ${OUT}/ (fill ${APK_ICON_FILL})`);
  console.log(`Squircle clipped pixels: ${clipped}`);

  if (clipped > 0) {
    throw new Error(`Launcher icon loses ${clipped}px to squircle mask — reduce APK_ICON_FILL`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
