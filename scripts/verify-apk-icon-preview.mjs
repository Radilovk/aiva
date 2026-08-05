#!/usr/bin/env node
/**
 * Verify launcher icon layers before building the APK.
 *
 * Simulates what a launcher actually does with the adaptive icon: crops the
 * central 72 dp of the 108 dp canvas, then applies a circle mask. Essential
 * artwork must survive; only a sliver of soft glow may be clipped.
 * Also writes flattened previews to .artifacts/icon-preview/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  renderApkForeground,
  renderApkBackground,
  renderApkLegacy,
  resolveMasterIcon,
  APK_FOREGROUND_FILL,
  APK_ICON_BG,
  ADAPTIVE_DP,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, '.artifacts', 'icon-preview');

const SIZE = ADAPTIVE_DP * 4; // xxxhdpi adaptive canvas (432px)
const VISIBLE = Math.round(SIZE * (72 / 108)); // launcher-visible crop
/** Soft neon glow may cross the circle edge; solid artwork must not. */
const MAX_CLIPPED_FRACTION = 0.02;

function circleMaskSvg(size) {
  const r = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="white"/></svg>`,
  );
}

async function countArtPixels(raw) {
  let count = 0;
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] >= 64) count += 1;
  }
  return count;
}

async function clippedByLauncherMask(fgBuf) {
  const off = Math.round((SIZE - VISIBLE) / 2);
  const visible = await sharp(fgBuf)
    .extract({ left: off, top: off, width: VISIBLE, height: VISIBLE })
    .png()
    .toBuffer();
  const masked = await sharp(visible)
    .composite([{ input: circleMaskSvg(VISIBLE), blend: 'dest-in' }])
    .raw()
    .toBuffer();
  const orig = await sharp(visible).raw().toBuffer();
  const full = await sharp(fgBuf).raw().toBuffer();

  const totalArt = await countArtPixels(full);
  const visibleArt = await countArtPixels(orig);
  let clipped = totalArt - visibleArt; // art outside the visible crop
  for (let i = 0; i < orig.length; i += 4) {
    if (orig[i + 3] >= 64 && masked[i + 3] < 32) clipped += 1;
  }
  return { clipped, totalArt };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const master = await resolveMasterIcon();
  const fgBuf = await (await renderApkForeground(master, SIZE)).png().toBuffer();
  const bgBuf = await renderApkBackground(SIZE).png().toBuffer();
  const flatBuf = await sharp(bgBuf).composite([{ input: fgBuf }]).png().toBuffer();
  const legacyBuf = await (await renderApkLegacy(master, 192)).png().toBuffer();

  const { clipped, totalArt } = await clippedByLauncherMask(fgBuf);
  const fraction = totalArt > 0 ? clipped / totalArt : 0;

  await writeFile(join(OUT, 'apk-foreground.png'), fgBuf);
  await writeFile(join(OUT, 'apk-adaptive-flat.png'), flatBuf);
  await writeFile(join(OUT, 'apk-legacy-icon.png'), legacyBuf);

  console.log(`Icon preview → ${OUT}/ (bg ${APK_ICON_BG}, fill ${APK_FOREGROUND_FILL.toFixed(3)})`);
  console.log(`Launcher circle mask: ${clipped}/${totalArt} art px clipped (${(fraction * 100).toFixed(2)}%)`);
  if (fraction > MAX_CLIPPED_FRACTION) {
    throw new Error(`Artwork clipped by launcher mask: ${(fraction * 100).toFixed(2)}% > ${MAX_CLIPPED_FRACTION * 100}%`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
