#!/usr/bin/env node
/**
 * Package B — process kasyico.png + kasyspl.png → frontend/icons.
 * Sources: brand-assets/source/, repo root, or Cursor artifacts.
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cropToSquareArt, renderIconSquare, renderMaskable } from './lib/kasy-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const ARTIFACTS_DIR = '/opt/cursor/artifacts/assets';
const SOURCE_DIR = process.env.SOURCE_DIR || join(ROOT, 'brand-assets', 'source');
const ICONS = join(ROOT, 'frontend', 'icons');
const ANDROID = join(ROOT, 'android-res', 'drawable');
const PACKAGE_OUT = join(ROOT, 'brand-assets', 'package-b');

const ICON_CANDIDATES = ['kasyico.png', 'kasy-icon-source.png'];
const SPLASH_CANDIDATES = ['kasyspl.png', 'kasy-splash-source.png'];
const LISTEN_CANDIDATES = ['kasy-listen-source.png', 'kasyico.png'];

async function exists(path) {
  try {
    await import('node:fs/promises').then((fs) => fs.access(path));
    return true;
  } catch {
    return false;
  }
}

async function resolveSource(candidates, label) {
  const dirs = [SOURCE_DIR, ROOT, ARTIFACTS_DIR];
  for (const dir of dirs) {
    for (const name of candidates) {
      const p = join(dir, name);
      if (await exists(p)) {
        console.log(`  ${label}: ${p}`);
        return p;
      }
    }
  }
  throw new Error(
    `Missing ${label}. Place one of [${candidates.join(', ')}] in repo root or brand-assets/source/`
  );
}

async function writePngWebp(pngBuf, baseName, webpQuality = 82) {
  const pngPath = join(ICONS, `${baseName}.png`);
  const webpPath = join(ICONS, `${baseName}.webp`);
  await writeFile(pngPath, pngBuf);
  const webp = await sharp(pngBuf).webp({ quality: webpQuality, effort: 6 }).toBuffer();
  await writeFile(webpPath, webp);
  await writeFile(join(PACKAGE_OUT, `${baseName}.png`), pngBuf);
  return pngBuf;
}

async function archiveSource(src, destName) {
  await mkdir(PACKAGE_OUT, { recursive: true });
  await copyFile(src, join(PACKAGE_OUT, destName));
}

async function squareIcon(input, size, outName, { fill = 0.86, transparent = false } = {}) {
  const buf = await renderIconSquare(input, { size, fill, transparent }).then((p) => p.toBuffer());
  await writePngWebp(buf, outName.replace(/\.png$/, ''));
  console.log(`  ✓ ${outName} (${size}px, fill ${Math.round(fill * 100)}%)`);
}

async function portraitSplash(input, width, height, outName) {
  const webp = await sharp(input).resize(width, height, { fit: 'cover', position: 'centre' })
    .webp({ quality: 78, effort: 6 }).toBuffer();
  const base = outName.replace(/\.(png|webp)$/, '');
  await writeFile(join(ICONS, `${base}.webp`), webp);
  await writeFile(join(PACKAGE_OUT, `${base}.webp`), webp);
  console.log(`  ✓ ${base}.webp (${width}x${height})`);
}

async function listenButton(input, displaySize) {
  const pixelSize = displaySize * 2;
  const art = await cropToSquareArt(input);
  const buf = await art
    .resize(pixelSize, pixelSize, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writePngWebp(buf, `listen-${displaySize}`, 85);
  console.log(`  ✓ listen-${displaySize}`);
}

async function notificationIcon(input) {
  const art = await cropToSquareArt(input);
  const buf = await art.resize(96, 96, { fit: 'cover' })
    .grayscale().normalize().png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(ICONS, 'ic-stat-notification.png'), buf);
  await writeFile(join(ANDROID, 'ic_stat_aiva.png'), buf);
  console.log('  ✓ ic-stat-notification.png');
}

async function ogImage(splashInput) {
  const png = await sharp(splashInput).resize(1200, 630, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 }).toBuffer();
  await writePngWebp(png, 'og-image', 80);
  console.log('  ✓ og-image');
}

async function androidSplash(splashInput) {
  const buf = await sharp(splashInput).resize(720, 1280, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer();
  await writeFile(join(ANDROID, 'splash.png'), buf);
  console.log('  ✓ android-res/drawable/splash.png');
}

export async function runPackageB() {
  console.log('Package B — from kasyico.png + kasyspl.png');
  const iconSrc = await resolveSource(ICON_CANDIDATES, 'Icon');
  const splashSrc = await resolveSource(SPLASH_CANDIDATES, 'Splash');
  let listenSrc = iconSrc;
  try {
    listenSrc = await resolveSource(LISTEN_CANDIDATES, 'Listen');
  } catch {
    console.log('  Listen: using icon source');
  }

  await mkdir(ICONS, { recursive: true });
  await mkdir(ANDROID, { recursive: true });
  await archiveSource(iconSrc, 'kasyico.png');
  await archiveSource(splashSrc, 'kasyspl.png');

  console.log('Icons (alpha-trim + scaled fill):');
  await squareIcon(iconSrc, 32, 'favicon-32.png', { fill: 0.9 });
  await squareIcon(iconSrc, 192, 'icon-192.png', { fill: 0.86 });
  await squareIcon(iconSrc, 512, 'icon-512.png', { fill: 0.86 });
  await squareIcon(iconSrc, 180, 'apple-touch-icon.png', { fill: 0.86 });
  const maskBuf = await renderMaskable(listenSrc, 512).then((p) => p.toBuffer());
  await writePngWebp(maskBuf, 'maskable-512');
  console.log('  ✓ maskable-512.png (safe zone)');

  console.log('Listen button:');
  for (const s of [120, 88, 44]) await listenButton(listenSrc, s);

  console.log('Splash:');
  await portraitSplash(splashSrc, 1080, 1920, 'splash-portrait-1080');
  await portraitSplash(splashSrc, 720, 1280, 'splash-portrait-720');
  await androidSplash(splashSrc);
  await ogImage(splashSrc);

  console.log('Notification:');
  await notificationIcon(listenSrc);

  await writeFile(join(ROOT, 'brand-assets', 'active-package'), 'B\n');
  console.log('Done — active package: B');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPackageB().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
