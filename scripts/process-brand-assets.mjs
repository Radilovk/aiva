#!/usr/bin/env node
/**
 * Process brand.jpg, button.jpg, splash.jpg → compressed web assets for Web/PWA/APK.
 * Sources: repo root or brand-assets/source/
 */
import { mkdir, writeFile, access, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, 'frontend', 'icons');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const BG = '#050508';

const FILES = {
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
  const brandSrc = await resolveSource('brand');
  const buttonSrc = await resolveSource('button');
  const splashSrc = await resolveSource('splash');

  console.log('KASY brand assets');
  console.log(`  brand:  ${brandSrc}`);
  console.log(`  button: ${buttonSrc}`);
  console.log(`  splash: ${splashSrc}`);

  await mkdir(OUT, { recursive: true });
  await archiveSources({ brand: brandSrc, button: buttonSrc, splash: splashSrc });

  console.log('\nBrand (logo + app icon):');
  await writeWebp(brandSrc, join(OUT, 'brand.webp'), { width: 512, height: 512 });
  await writeWebp(brandSrc, join(OUT, 'icon-512.webp'), { width: 512, height: 512 });
  const icon192 = await sharp(brandSrc)
    .resize(192, 192, { fit: 'contain', background: BG, position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, 'icon-192.png'), icon192);
  console.log(`  ✓ frontend/icons/icon-192.png (192×192, ${(icon192.length / 1024).toFixed(1)} KB)`);
  await writeWebp(brandSrc, join(OUT, 'favicon-32.webp'), { width: 32, height: 32, quality: 78 });

  const notif = await sharp(brandSrc)
    .resize(96, 96, { fit: 'contain', background: BG })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, 'ic-stat-notification.png'), notif);
  console.log(`  ✓ frontend/icons/ic-stat-notification.png`);

  console.log('\nButton (listen):');
  await writeWebp(buttonSrc, join(OUT, 'button.webp'), { width: 512, height: 512 });

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
