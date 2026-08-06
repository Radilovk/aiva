#!/usr/bin/env node
/**
 * Brand assets — icons copied as-is (alpha preserved, no crop/resize).
 * Sources: PSX_*.png or brand-assets/source/icon-{192,512}.png
 */
import { mkdir, writeFile, access, copyFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderSquareIcon } from './lib/brand-icon-prep.mjs';
import { renderApkLegacy, APP_WINDOW_BG } from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, 'frontend', 'icons');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const BG = '#050508';

const ICON_192_CANDIDATES = [
  join(SOURCE_DIR, 'icon-192.png'),
  join(ROOT, 'PSX_20260805_210411.png'),
  join(SOURCE_DIR, 'PSX_20260805_210411.png'),
];

const ICON_512_CANDIDATES = [
  join(SOURCE_DIR, 'icon-512.png'),
  join(ROOT, 'PSX_20260805_210455.png'),
  join(SOURCE_DIR, 'PSX_20260805_210455.png'),
];

const BRAND_CANDIDATES = ['brand.jpg', 'brand.jpeg', 'brand.png'];
const BUTTON_CANDIDATES = ['button.jpg', 'button.jpeg', 'button.png'];
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveFirst(candidates) {
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  return null;
}

async function resolveInDirs(names) {
  for (const dir of [SOURCE_DIR, ROOT]) {
    for (const name of names) {
      const p = join(dir, name);
      if (await exists(p)) return p;
    }
  }
  throw new Error(`Missing source. Tried: ${names.join(', ')}`);
}

async function writeSquareWebp(input, dest, size, { fill = 0.92, quality = 82 } = {}) {
  const buf = await renderSquareIcon(input, {
    size,
    fill,
    transparent: false,
    bg: BG,
  }).then((p) => p.webp({ quality, effort: 6 }).toBuffer());
  await writeFile(dest, buf);
  const meta = await sharp(buf).metadata();
  console.log(`  ✓ ${dest.replace(`${ROOT}/`, '')} (${meta.width}×${meta.height}, ${(buf.length / 1024).toFixed(1)} KB)`);
}

export async function processBrandAssets() {
  const icon192Src = await resolveFirst(ICON_192_CANDIDATES);
  const icon512Src = await resolveFirst(ICON_512_CANDIDATES);
  if (!icon192Src || !icon512Src) {
    throw new Error('Missing icon sources. Add PSX_20260805_210411.png (192) and PSX_20260805_210455.png (512).');
  }

  const brandSrc = await resolveInDirs(BRAND_CANDIDATES);
  const buttonSrc = await resolveInDirs(BUTTON_CANDIDATES);

  console.log('KASY brand assets');
  console.log(`  icon-192: ${icon192Src}`);
  console.log(`  icon-512: ${icon512Src}`);
  console.log(`  brand:    ${brandSrc}`);
  console.log(`  button:   ${buttonSrc}`);

  await mkdir(OUT, { recursive: true });
  await mkdir(SOURCE_DIR, { recursive: true });
  await copyFile(icon192Src, join(SOURCE_DIR, 'icon-192.png'));
  await copyFile(icon512Src, join(SOURCE_DIR, 'icon-512.png'));

  console.log('\nApp icons (circular neon disc, transparent corners):');
  const icon192Buf = await renderApkLegacy(icon192Src, 192)
    .then((p) => p.png({ compressionLevel: 9 }).toBuffer());
  const icon512Buf = await renderApkLegacy(icon512Src, 512)
    .then((p) => p.png({ compressionLevel: 9 }).toBuffer());
  await writeFile(join(OUT, 'icon-192.png'), icon192Buf);
  const m192 = await sharp(icon192Buf).metadata();
  console.log(`  ✓ frontend/icons/icon-192.png (${m192.width}×${m192.height}, ${(icon192Buf.length / 1024).toFixed(1)} KB)`);

  await writeFile(join(OUT, 'icon-512.png'), icon512Buf);
  const icon512Webp = await sharp(icon512Buf).webp({ quality: 90, effort: 6, lossless: false }).toBuffer();
  await writeFile(join(OUT, 'icon-512.webp'), icon512Webp);
  const m512 = await sharp(icon512Buf).metadata();
  console.log(`  ✓ frontend/icons/icon-512.png (${m512.width}×${m512.height})`);
  console.log(`  ✓ frontend/icons/icon-512.webp (${(icon512Webp.length / 1024).toFixed(1)} KB)`);

  // iOS изисква непрозрачна apple-touch икона — кръглият диск върху тъмния
  // бранд фон (iOS сам заобля ъглите)
  const appleTouch = await sharp({
    create: { width: 180, height: 180, channels: 4, background: APP_WINDOW_BG },
  })
    .composite([{ input: await renderApkLegacy(icon512Src, 180).then((p) => p.png().toBuffer()) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, 'apple-touch-icon.png'), appleTouch);
  console.log('  ✓ frontend/icons/apple-touch-icon.png (180×180, opaque)');

  // Из суровия източник (не от кръглия диск) — status-bar иконата е силует
  const notif = await sharp(icon192Src)
    .resize(96, 96, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, 'ic-stat-notification.png'), notif);
  console.log('  ✓ frontend/icons/ic-stat-notification.png');

  console.log('\nBrand (header logo):');
  await writeSquareWebp(brandSrc, join(OUT, 'brand.webp'), 512, { fill: 0.92 });
  await sharp(brandSrc).resize(32, 32, { fit: 'inside', background: BG }).webp({ quality: 78 }).toFile(join(OUT, 'favicon-32.webp'));

  console.log('\nButton (listen):');
  await writeSquareWebp(buttonSrc, join(OUT, 'button.webp'), 512, { fill: 0.92 });

  console.log('\nDone.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  processBrandAssets().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
