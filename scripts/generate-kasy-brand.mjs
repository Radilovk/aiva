#!/usr/bin/env node
/**
 * Package B — humanoid art (kasyico / kasyspl) with speech bubble + task calendar overlays.
 * Raster PNG/WebP output (not abstract SVG icons). Run via: node scripts/apply-brand-package.mjs B
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { cropToSquareArt, renderIconSquare, renderMaskable } from './lib/kasy-icon-prep.mjs';
import { iconOverlaySvg, splashOverlaySvg } from './lib/kasy-brand-overlays.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const ARTIFACTS_DIR = '/opt/cursor/artifacts/assets';
const SOURCE_DIR = process.env.SOURCE_DIR || join(ROOT, 'brand-assets', 'source');
const OUT = join(ROOT, 'frontend', 'icons', 'pack-b');
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

async function renderOverlay(svg, width, height) {
  return sharp(Buffer.from(svg)).resize(width, height).png().toBuffer();
}

async function compositeOverlay(baseBuf, overlaySvg, width, height) {
  const overlay = await renderOverlay(overlaySvg, width, height);
  return sharp(baseBuf).composite([{ input: overlay, blend: 'over' }]).png({ compressionLevel: 9 }).toBuffer();
}

async function writePngWebp(pngBuf, baseName, webpQuality = 82) {
  const pngPath = join(OUT, `${baseName}.png`);
  const webpPath = join(OUT, `${baseName}.webp`);
  await writeFile(pngPath, pngBuf);
  const webp = await sharp(pngBuf).webp({ quality: webpQuality, effort: 6 }).toBuffer();
  await writeFile(webpPath, webp);
  await writeFile(join(PACKAGE_OUT, `${baseName}.png`), pngBuf);
}

async function iconWithOverlays(iconSrc, size, { fill = 0.8, extras = true } = {}) {
  const base = await renderIconSquare(iconSrc, { size, fill }).then((p) => p.toBuffer());
  if (!extras) return base;
  return compositeOverlay(base, iconOverlaySvg(size), size, size);
}

async function splashWithOverlays(splashSrc, width, height) {
  const base = await sharp(splashSrc)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return compositeOverlay(base, splashOverlaySvg(width, height), width, height);
}

async function listenButton(iconSrc, displaySize, { extras = false } = {}) {
  const pixelSize = displaySize * 2;
  const art = await cropToSquareArt(iconSrc);
  let buf = await art.resize(pixelSize, pixelSize, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
  if (extras) {
    buf = await compositeOverlay(buf, iconOverlaySvg(pixelSize), pixelSize, pixelSize);
  }
  await writePngWebp(buf, `listen-${displaySize}`, 85);
  console.log(`  ✓ listen-${displaySize}`);
}

async function notificationIcon(iconSrc) {
  const art = await cropToSquareArt(iconSrc);
  const buf = await art.resize(96, 96, { fit: 'cover' })
    .grayscale().normalize().png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(OUT, 'ic-stat-notification.png'), buf);
  console.log('  ✓ ic-stat-notification.png');
}

async function main() {
  console.log('Package B — humanoid + speech bubble + task calendar');
  const iconSrc = await resolveSource(ICON_CANDIDATES, 'Icon');
  const splashSrc = await resolveSource(SPLASH_CANDIDATES, 'Splash');
  let listenSrc = iconSrc;
  try {
    listenSrc = await resolveSource(LISTEN_CANDIDATES, 'Listen');
  } catch {
    console.log('  Listen: using icon source');
  }

  await mkdir(OUT, { recursive: true });
  await mkdir(PACKAGE_OUT, { recursive: true });

  console.log('Icons (humanoid + overlays):');
  for (const [name, size, opts] of [
    ['favicon-32', 32, { fill: 0.82 }],
    ['icon-192', 192, { fill: 0.78 }],
    ['icon-512', 512, { fill: 0.78 }],
    ['apple-touch-icon', 180, { fill: 0.78 }],
  ]) {
    const buf = await iconWithOverlays(iconSrc, size, { ...opts, extras: true });
    await writePngWebp(buf, name);
    console.log(`  ✓ ${name}.png`);
  }

  const maskBuf = await renderMaskable(listenSrc, 512).then(async (p) => {
    const base = await p.toBuffer();
    return compositeOverlay(base, iconOverlaySvg(512), 512, 512);
  });
  await writePngWebp(maskBuf, 'maskable-512');
  console.log('  ✓ maskable-512.png');

  console.log('Brand mark:');
  const markBuf = await iconWithOverlays(iconSrc, 512, { fill: 0.76, extras: true });
  await writePngWebp(markBuf, 'brand-mark', 86);
  await writeFile(join(OUT, 'logo-mark.png'), markBuf);
  await writeFile(join(PACKAGE_OUT, 'logo-mark.png'), markBuf);
  console.log('  ✓ brand-mark (humanoid + overlays)');

  console.log('Listen button (humanoid, no overlay):');
  for (const s of [120, 88, 44]) await listenButton(listenSrc, s, { extras: false });

  console.log('Splash (humanoid + schedule overlay):');
  for (const [name, w, h] of [['splash-portrait-1080', 1080, 1920], ['splash-portrait-720', 720, 1280]]) {
    const buf = await splashWithOverlays(splashSrc, w, h);
    const webp = await sharp(buf).webp({ quality: 78, effort: 6 }).toBuffer();
    await writeFile(join(OUT, `${name}.webp`), webp);
    await writeFile(join(PACKAGE_OUT, `${name}.webp`), webp);
    console.log(`  ✓ ${name}.webp`);
  }

  const androidSplash = await splashWithOverlays(splashSrc, 720, 1280);
  await writeFile(join(OUT, 'splash-android.png'), androidSplash);
  console.log('  ✓ splash-android.png');

  const ogBuf = await splashWithOverlays(splashSrc, 1200, 630);
  await writePngWebp(ogBuf, 'og-image', 80);
  console.log('  ✓ og-image.png');

  console.log('Notification:');
  await notificationIcon(listenSrc);

  console.log('Done — package B assets in frontend/icons/pack-b/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
