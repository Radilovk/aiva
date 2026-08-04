#!/usr/bin/env node
/**
 * Package B — process user-provided kasyico.png + kasyspl.png → frontend/icons.
 * Place files in brand-assets/source/ then: node scripts/apply-brand-package.mjs B
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
  const dirs = [SOURCE_DIR, ARTIFACTS_DIR];
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
    `Missing ${label}. Place one of [${candidates.join(', ')}] in brand-assets/source/`
  );
}

async function writePngWebp(styledSharp, pngPath, webpPath, webpQuality = 82) {
  const png = await styledSharp.png({ compressionLevel: 9, effort: 10 }).toBuffer();
  await writeFile(pngPath, png);
  const webp = await sharp(png).webp({ quality: webpQuality, effort: 6 }).toBuffer();
  await writeFile(webpPath, webp);
  return png;
}

async function archiveSource(src, destName) {
  await mkdir(PACKAGE_OUT, { recursive: true });
  await copyFile(src, join(PACKAGE_OUT, destName));
}

async function squareIcon(input, size, outName, { padding = 0, fit = 'cover' } = {}) {
  let pipeline = sharp(input);
  if (padding > 0) {
    const pad = Math.round(size * padding);
    pipeline = pipeline.resize(size - pad * 2, size - pad * 2, { fit, position: 'centre' })
      .extend({
        top: pad, bottom: pad, left: pad, right: pad,
        background: { r: 5, g: 5, b: 8, alpha: 1 },
      });
  } else {
    pipeline = pipeline.resize(size, size, { fit, position: 'centre' });
  }
  const base = join(ICONS, outName.replace(/\.png$/, ''));
  const png = await writePngWebp(pipeline, `${base}.png`, `${base}.webp`);
  await writeFile(join(PACKAGE_OUT, `${outName.replace(/\.png$/, '')}-${size}.png`), png);
  console.log(`  ✓ ${outName} (${size}px)`);
}

async function portraitSplash(input, width, height, outName) {
  const webp = await sharp(input).resize(width, height, { fit: 'cover', position: 'centre' })
    .webp({ quality: 78, effort: 6 }).toBuffer();
  const base = join(ICONS, outName.replace(/\.(png|webp)$/, ''));
  await writeFile(`${base}.webp`, webp);
  await writeFile(join(PACKAGE_OUT, `${outName}.webp`), webp);
  console.log(`  ✓ ${outName}.webp (${width}x${height})`);
}

async function listenButton(input, displaySize) {
  const pixelSize = displaySize * 2;
  const pipeline = sharp(input).resize(pixelSize, pixelSize, { fit: 'cover', position: 'centre' });
  const base = join(ICONS, `listen-${displaySize}`);
  await writePngWebp(pipeline, `${base}.png`, `${base}.webp`, 85);
  console.log(`  ✓ listen-${displaySize}`);
}

async function notificationIcon(input) {
  const buf = await sharp(input).resize(96, 96, { fit: 'cover', position: 'centre' })
    .grayscale().normalize().png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(ICONS, 'ic-stat-notification.png'), buf);
  await writeFile(join(ANDROID, 'ic_stat_aiva.png'), buf);
  console.log('  ✓ ic-stat-notification.png');
}

async function ogImage(splashInput) {
  const base = join(ICONS, 'og-image');
  const pipeline = sharp(splashInput).resize(1200, 630, { fit: 'cover', position: 'centre' });
  await writePngWebp(pipeline, `${base}.png`, `${base}.webp`, 80);
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

  console.log('Icons:');
  await squareIcon(iconSrc, 32, 'favicon-32.png', { padding: 0.04 });
  await squareIcon(iconSrc, 192, 'icon-192.png');
  await squareIcon(iconSrc, 512, 'icon-512.png');
  await squareIcon(iconSrc, 180, 'apple-touch-icon.png');
  await squareIcon(listenSrc, 512, 'maskable-512.png', { padding: 0.12, fit: 'contain' });

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
