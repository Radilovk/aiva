#!/usr/bin/env node
/**
 * Process brand.jpg, button.jpg, splash.jpg, icon1.png → compressed web assets for Web/PWA/APK.
 * Sources: repo root or brand-assets/source/
 */
import { mkdir, writeFile, access, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  APP_ICON_FILL,
  renderSquareIcon,
  renderWebIconPng,
  renderWebIconWebp,
  trimAlphaArt,
} from './lib/brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, 'frontend', 'icons');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const BG = '#050508';

const FILES = {
  icon: ['icon1.png'],
  brand: ['brand.jpg', 'brand.jpeg', 'brand.png'],
  button: ['button.jpg', 'button.jpeg', 'button.png'],
  splash: ['splash.jpg', 'splash.jpeg', 'splash.png'],
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveSource(kind) {
  const dirs = [SOURCE_DIR, ROOT];
  for (const dir of dirs) {
    for (const name of FILES[kind]) {
      const p = join(dir, name);
      if (await exists(p)) return p;
    }
  }
  throw new Error(`Missing ${kind} source. Add ${FILES[kind][0]} to repo root or brand-assets/source/`);
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
  console.log(`  ✓ ${dest.replace(`${ROOT}/`, '')} (${meta.width}×${meta.height}, fill ${Math.round(fill * 100)}%, ${(buf.length / 1024).toFixed(1)} KB)`);
}

async function writeWebp(input, dest, { width, height, fit = 'contain', quality = 82 } = {}) {
  let pipeline = sharp(input);
  if (width || height) {
    pipeline = pipeline.resize(width, height, {
      fit,
      background: BG,
      position: 'centre',
      withoutEnlargement: false,
    });
  }
  const buf = await pipeline.webp({ quality, effort: 6 }).toBuffer();
  await writeFile(dest, buf);
  const meta = await sharp(buf).metadata();
  console.log(`  ✓ ${dest.replace(`${ROOT}/`, '')} (${meta.width}×${meta.height}, ${(buf.length / 1024).toFixed(1)} KB)`);
  return buf;
}

async function archiveSources(paths) {
  await mkdir(SOURCE_DIR, { recursive: true });
  for (const [name, src] of Object.entries(paths)) {
    const ext = src.slice(src.lastIndexOf('.'));
    await copyFile(src, join(SOURCE_DIR, `${name}${ext}`));
  }
}

export async function processBrandAssets() {
  const iconSrc = await resolveSource('icon');
  const brandSrc = await resolveSource('brand');
  const buttonSrc = await resolveSource('button');
  const splashSrc = await resolveSource('splash');

  console.log('KASY brand assets');
  console.log(`  icon:   ${iconSrc}`);
  console.log(`  brand:  ${brandSrc}`);
  console.log(`  button: ${buttonSrc}`);
  console.log(`  splash: ${splashSrc}`);

  await mkdir(OUT, { recursive: true });
  await archiveSources({
    icon: iconSrc,
    brand: brandSrc,
    button: buttonSrc,
    splash: splashSrc,
  });

  console.log('\nApp icon (transparent icon1.png — same as APK):');
  const icon512Webp = await renderWebIconWebp(iconSrc, 512, { fill: APP_ICON_FILL, quality: 82 });
  await writeFile(join(OUT, 'icon-512.webp'), icon512Webp);
  console.log(`  ✓ frontend/icons/icon-512.webp (512×512, fill ${Math.round(APP_ICON_FILL * 100)}%, ${(icon512Webp.length / 1024).toFixed(1)} KB)`);

  const icon192 = await renderWebIconPng(iconSrc, 192, { fill: APP_ICON_FILL })
    .then((p) => p.png({ compressionLevel: 9 }).toBuffer());
  await writeFile(join(OUT, 'icon-192.png'), icon192);
  console.log(`  ✓ frontend/icons/icon-192.png (192×192, ${(icon192.length / 1024).toFixed(1)} KB)`);

  const trimmedIcon = await trimAlphaArt(iconSrc);
  const notif = await sharp(trimmedIcon)
    .resize(96, 96, { fit: 'inside' })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, 'ic-stat-notification.png'), notif);
  console.log('  ✓ frontend/icons/ic-stat-notification.png');

  console.log('\nBrand (header logo from brand.jpg):');
  await writeSquareWebp(brandSrc, join(OUT, 'brand.webp'), 512, { fill: 0.92 });
  await writeWebp(brandSrc, join(OUT, 'favicon-32.webp'), { width: 32, height: 32, quality: 78 });

  console.log('\nButton (listen):');
  await writeSquareWebp(buttonSrc, join(OUT, 'button.webp'), 512, { fill: 0.92 });

  console.log('\nSplash (contain, no crop — preserve aspect):');
  const splashMeta = await sharp(splashSrc).metadata();
  await writeWebp(splashSrc, join(OUT, 'splash.webp'), {
    width: splashMeta.width,
    height: splashMeta.height,
    fit: 'inside',
    quality: 84,
  });

  console.log('\nDone.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  processBrandAssets().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
