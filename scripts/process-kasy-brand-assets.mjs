#!/usr/bin/env node
/**
 * Resize & compress KASY brand sources → frontend/icons + android splash.
 *
 * Place sources in brand-assets/source/ or attach in Cursor (saved under
 * /opt/cursor/artifacts/assets/ as kasy-icon-source.png, kasy-splash-source.png,
 * kasy-listen-source.png). Run: node scripts/process-kasy-brand-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
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

async function exists(path) {
  try {
    await import('node:fs/promises').then((fs) => fs.access(path));
    return true;
  } catch {
    return false;
  }
}

async function writePngWebp(styledSharp, pngPath, webpPath, webpQuality = 82) {
  const png = await styledSharp.png({ compressionLevel: 9, effort: 10 }).toBuffer();
  await writeFile(pngPath, png);
  const webp = await sharp(png).webp({ quality: webpQuality, effort: 6 }).toBuffer();
  await writeFile(webpPath, webp);
  return { png: png.length, webp: webp.length };
}

async function squareIcon(input, size, outName, { padding = 0, fit = 'cover' } = {}) {
  const meta = await sharp(input).metadata();
  let pipeline = sharp(input);
  if (padding > 0) {
    const pad = Math.round(size * padding);
    pipeline = pipeline.resize(size - pad * 2, size - pad * 2, { fit, position: 'centre' })
      .extend({
        top: pad,
        bottom: pad,
        left: pad,
        right: pad,
        background: { r: 5, g: 5, b: 8, alpha: 1 },
      });
  } else {
    pipeline = pipeline.resize(size, size, { fit, position: 'centre' });
  }
  const base = join(ICONS, outName.replace(/\.png$/, ''));
  const sizes = await writePngWebp(pipeline, `${base}.png`, `${base}.webp`);
  console.log(`  ✓ ${outName} (${size}px) png ${(sizes.png / 1024).toFixed(1)}KB webp ${(sizes.webp / 1024).toFixed(1)}KB`);
}

async function portraitSplash(input, width, height, outName) {
  const pipeline = sharp(input).resize(width, height, { fit: 'cover', position: 'centre' });
  const base = join(ICONS, outName.replace(/\.(png|webp)$/, ''));
  const webp = await pipeline.webp({ quality: 78, effort: 6 }).toBuffer();
  await writeFile(`${base}.webp`, webp);
  console.log(`  ✓ ${outName}.webp (${width}x${height}) ${(webp.length / 1024).toFixed(1)}KB`);
}

async function listenButton(input, displaySize) {
  const pixelSize = displaySize * 2;
  const pipeline = sharp(input).resize(pixelSize, pixelSize, { fit: 'cover', position: 'centre' });
  const base = join(ICONS, `listen-${displaySize}`);
  const sizes = await writePngWebp(pipeline, `${base}.png`, `${base}.webp`, 85);
  console.log(`  ✓ listen-${displaySize} (${pixelSize}px) png ${(sizes.png / 1024).toFixed(1)}KB webp ${(sizes.webp / 1024).toFixed(1)}KB`);
}

async function notificationIcon(input) {
  const pipeline = sharp(input)
    .resize(96, 96, { fit: 'cover', position: 'centre' })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 9 });
  const buf = await pipeline.toBuffer();
  await writeFile(join(ICONS, 'ic-stat-notification.png'), buf);
  await writeFile(join(ANDROID, 'ic_stat_aiva.png'), buf);
  console.log(`  ✓ ic-stat-notification.png (${(buf.length / 1024).toFixed(1)}KB)`);
}

async function ogImage(splashInput) {
  const pipeline = sharp(splashInput)
    .resize(1200, 630, { fit: 'cover', position: 'centre' });
  const base = join(ICONS, 'og-image');
  const sizes = await writePngWebp(pipeline, `${base}.png`, `${base}.webp`, 80);
  console.log(`  ✓ og-image (1200x630) png ${(sizes.png / 1024).toFixed(1)}KB`);
}

async function androidSplash(splashInput) {
  const pipeline = sharp(splashInput).resize(720, 1280, { fit: 'cover', position: 'centre' });
  const buf = await pipeline.png({ compressionLevel: 9, effort: 10, palette: true }).toBuffer();
  await writeFile(join(ANDROID, 'splash.png'), buf);
  console.log(`  ✓ android-res/drawable/splash.png (${(buf.length / 1024).toFixed(1)}KB)`);
}

async function main() {
  let sourceDir = SOURCE_DIR;
  const names = ['kasy-icon-source.png', 'kasy-splash-source.png', 'kasy-listen-source.png'];
  let hasAllInSource = true;
  for (const n of names) {
    if (!(await exists(join(SOURCE_DIR, n)))) hasAllInSource = false;
  }
  if (!hasAllInSource && await exists(join(ARTIFACTS_DIR, names[0]))) {
    sourceDir = ARTIFACTS_DIR;
    console.log(`Using Cursor attachments: ${ARTIFACTS_DIR}`);
  }

  const iconSrc = join(sourceDir, 'kasy-icon-source.png');
  const splashSrc = join(sourceDir, 'kasy-splash-source.png');
  const listenSrc = join(sourceDir, 'kasy-listen-source.png');

  for (const p of [iconSrc, splashSrc, listenSrc]) {
    if (!await exists(p)) {
      console.error(`Missing source: ${p}`);
      console.error('Copy PNGs to brand-assets/source/ or set SOURCE_DIR');
      process.exit(1);
    }
  }

  await mkdir(ICONS, { recursive: true });
  await mkdir(ANDROID, { recursive: true });

  console.log('Icons (from kasy-icon-source + listen for maskable):');
  await squareIcon(iconSrc, 32, 'favicon-32.png', { padding: 0.04 });
  await squareIcon(iconSrc, 192, 'icon-192.png');
  await squareIcon(iconSrc, 512, 'icon-512.png');
  await squareIcon(iconSrc, 180, 'apple-touch-icon.png');
  await squareIcon(listenSrc, 512, 'maskable-512.png', { padding: 0.12, fit: 'contain' });

  console.log('Listen button (from kasy-listen-source):');
  await listenButton(listenSrc, 120);
  await listenButton(listenSrc, 88);
  await listenButton(listenSrc, 44);

  console.log('Splash:');
  await portraitSplash(splashSrc, 1080, 1920, 'splash-portrait-1080');
  await portraitSplash(splashSrc, 720, 1280, 'splash-portrait-720');
  await androidSplash(splashSrc);
  await ogImage(splashSrc);

  console.log('Notification:');
  await notificationIcon(listenSrc);

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
