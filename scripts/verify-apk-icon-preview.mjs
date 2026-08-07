#!/usr/bin/env node
/**
 * Verify maskable adaptive icon pipeline: legacy opaque tile, adaptive fg safe zone.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const ANDROID_RES = join(ROOT, 'android-res');
const ADAPTIVE_CANVAS = 432;
const LEGACY_SIZE = 192;

function squircleMaskSvg(size) {
  const r = size * 0.22;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/></svg>`,
  );
}

async function cornerAlpha(buf, size) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const corners = [
    data[3],
    data[(w - 1) * 4 + 3],
    data[(h - 1) * w * 4 + 3],
    data[(h * w - 1) * 4 + 3],
  ];
  return corners;
}

async function hasOpaqueCenter(buf, size) {
  const region = Math.floor(size * 0.25);
  const left = Math.floor((size - region) / 2);
  const top = Math.floor((size - region) / 2);
  const crop = await sharp(buf)
    .extract({ left, top, width: region, height: region })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < crop.data.length; i += 4) {
    if (crop.data[i] > 128) return true;
  }
  return false;
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

async function check(name, ok, detail = '') {
  const line = `${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`;
  console.log(line);
  return ok ? 0 : 1;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const fgBuf = await (await renderAdaptiveForeground(ICON, ADAPTIVE_CANVAS)).png().toBuffer();
  const legacyBuf = await renderLegacyLauncher(ICON, LEGACY_SIZE).png().toBuffer();
  const fgMeta = await sharp(fgBuf).metadata();
  const clipped = await clippedArtPixels(fgBuf, ADAPTIVE_CANVAS);
  const legacyCorners = await cornerAlpha(legacyBuf, LEGACY_SIZE);
  const fgCorners = await cornerAlpha(fgBuf, ADAPTIVE_CANVAS);
  const fgCenter = await hasOpaqueCenter(fgBuf, ADAPTIVE_CANVAS);

  await writeFile(join(OUT, 'apk-adaptive-fg-432.png'), fgBuf);
  await writeFile(join(OUT, 'apk-legacy-192.png'), legacyBuf);

  console.log(`Icon preview → ${OUT}/ (bg ${APK_ICON_BG}, safe ${SAFE_ZONE_RATIO.toFixed(3)})`);

  let failed = 0;
  failed += await check(
    'adaptive foreground 432×432',
    fgMeta.width === ADAPTIVE_CANVAS && fgMeta.height === ADAPTIVE_CANVAS,
    `${fgMeta.width}×${fgMeta.height}`,
  );
  failed += await check('no squircle clipping', clipped === 0, `${clipped}px clipped`);
  failed += await check(
    'legacy corners opaque (maskable tile)',
    legacyCorners.every((a) => a > 200),
    legacyCorners.join(','),
  );
  failed += await check(
    'foreground corners transparent',
    fgCorners.every((a) => a < 20),
    fgCorners.join(','),
  );
  failed += await check('foreground has opaque center art', fgCenter);

  const adaptiveXml = join(ANDROID_RES, 'mipmap-anydpi-v26', 'ic_launcher.xml');
  let xmlOk = false;
  try {
    const xml = await readFile(adaptiveXml, 'utf8');
    xmlOk = xml.includes('@color/ic_launcher_background') && xml.includes('ic_launcher_foreground');
  } catch {
    /* missing */
  }
  failed += await check('adaptive icon XML in android-res', xmlOk, adaptiveXml);

  if (failed > 0) throw new Error(`${failed} verify check(s) failed`);
  console.log(`\n${6 - failed}/6 checks passed`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
