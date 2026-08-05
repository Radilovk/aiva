#!/usr/bin/env node
/**
 * Package A — your uploaded art (kasyico.png + kasyspl.png + kasybutton.png).
 * No generated overlays. Sources: brand-assets/source/, repo root, or Cursor artifacts.
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
const OUT = join(ROOT, 'frontend', 'icons', 'pack-a');
const PACKAGE_OUT = join(ROOT, 'brand-assets', 'package-a');

const ICON_CANDIDATES = ['kasyico.png', 'kasy-icon-source.png'];
const SPLASH_CANDIDATES = ['kasyspl.png', 'kasy-splash-source.png'];
const LISTEN_CANDIDATES = ['kasy-listen-source.png', 'kasyico.png'];
const BUTTON_CANDIDATES = ['kasybutton.png', 'kasy-button-source.png'];

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
  const pngPath = join(OUT, `${baseName}.png`);
  const webpPath = join(OUT, `${baseName}.webp`);
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
  await writeFile(join(OUT, `${base}.webp`), webp);
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
  await writeFile(join(OUT, 'ic-stat-notification.png'), buf);
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
  await writeFile(join(OUT, 'splash-android.png'), buf);
  console.log('  ✓ splash-android.png');
}

async function brandMarkFromButton(input) {
  const meta = await sharp(input).metadata();
  const maxDim = Math.max(meta.width || 512, meta.height || 512);
  const target = Math.min(512, Math.max(192, Math.round(maxDim)));

  const png = await sharp(input)
    .resize(target, target, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();

  await writePngWebp(png, 'brand-mark', 86);
  await writeFile(join(OUT, 'logo-mark.png'), png);
  await writeFile(join(PACKAGE_OUT, 'logo-mark.png'), png);
  console.log(`  ✓ brand-mark (${target}px from kasybutton.png)`);
}

export async function runPackageA() {
  console.log('Package A — your uploads (kasyico + kasyspl + kasybutton)');
  const iconSrc = await resolveSource(ICON_CANDIDATES, 'Icon');
  const splashSrc = await resolveSource(SPLASH_CANDIDATES, 'Splash');
  let listenSrc = iconSrc;
  try {
    listenSrc = await resolveSource(LISTEN_CANDIDATES, 'Listen');
  } catch {
    console.log('  Listen: using icon source');
  }
  let buttonSrc = listenSrc;
  try {
    buttonSrc = await resolveSource(BUTTON_CANDIDATES, 'Brand mark');
  } catch {
    console.log('  Brand mark: using listen/icon source');
  }

  await mkdir(OUT, { recursive: true });
  await archiveSource(iconSrc, 'kasyico.png');
  await archiveSource(splashSrc, 'kasyspl.png');
  if (buttonSrc !== listenSrc) {
    await archiveSource(buttonSrc, 'kasybutton.png');
  }

  console.log('Brand mark (kasybutton):');
  await brandMarkFromButton(buttonSrc);

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

  console.log('Done — package A assets in frontend/icons/pack-a/');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPackageA().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
