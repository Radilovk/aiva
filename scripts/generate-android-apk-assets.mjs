#!/usr/bin/env node
/**
 * Android launcher icons — same PNG files as PWA, scaled per density (contain, no crop).
 */
import { mkdir, writeFile, readFile, readdir, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const FRONTEND_ICONS = join(ROOT, 'frontend', 'icons');

const BRAND_BG = '#050508';
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const MIPMAP_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

const SPLASH_LAYER_XML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background"/>
</layer-list>
`;

async function exists(path) {
  try {
    await import('node:fs/promises').then((fs) => fs.access(path));
    return true;
  } catch {
    return false;
  }
}

async function resolveIcon512() {
  const candidates = [
    join(FRONTEND_ICONS, 'icon-512.png'),
    join(SOURCE_DIR, 'icon-512.png'),
    join(ROOT, 'PSX_20260805_210455.png'),
  ];
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  throw new Error('Missing icon-512.png / PSX_20260805_210455.png');
}

async function resolveIcon192() {
  const candidates = [
    join(FRONTEND_ICONS, 'icon-192.png'),
    join(SOURCE_DIR, 'icon-192.png'),
    join(ROOT, 'PSX_20260805_210411.png'),
  ];
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  throw new Error('Missing icon-192.png / PSX_20260805_210411.png');
}

/** Scale icon to density — contain on transparent square, never crop artwork. */
async function scaleIcon(input, size) {
  const meta = await sharp(input).metadata();
  if (meta.width === size && meta.height === size) {
    return readFile(input);
  }
  return sharp(input)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeLauncherIcons(icon512Path, icon192Path) {
  const icon192Buf = await readFile(icon192Path);

  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });

    const iconBuf = size === 192
      ? icon192Buf
      : await scaleIcon(icon512Path, size);

    await writeFile(join(folder, 'ic_launcher.png'), iconBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), iconBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), iconBuf);
    console.log(`  ✓ ${dir}/ ${size}px (passthrough, alpha)`);
  }
}

async function removeDensitySplashes() {
  let entries = [];
  try {
    entries = await readdir(OUT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (/^drawable-(port|land)-/.test(entry.name)) {
      await rm(join(OUT, entry.name), { recursive: true, force: true });
    }
  }
}

async function writeSplashDrawable() {
  const androidResDrawable = join(ROOT, 'android-res', 'drawable');
  await mkdir(androidResDrawable, { recursive: true });
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  await writeFile(join(androidResDrawable, 'splash.xml'), SPLASH_LAYER_XML);
  await writeFile(join(OUT, 'drawable', 'splash.xml'), SPLASH_LAYER_XML);
  for (const legacy of ['splash_art.webp', 'splash_art.png', 'splash.png', 'splash.webp']) {
    for (const dir of [androidResDrawable, join(OUT, 'drawable')]) {
      try {
        await unlink(join(dir, legacy));
      } catch {
        /* ok */
      }
    }
  }
  console.log('  ✓ drawable/splash.xml (solid bg; splash.webp in WebView)');
  await removeDensitySplashes();
}

async function writeNotificationIcon(icon192Path) {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  const buf = await sharp(icon192Path)
    .resize(96, 96, { fit: 'inside', background: TRANSPARENT })
    .grayscale()
    .normalize()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(OUT, 'drawable', 'ic_stat_aiva.png'), buf);
  console.log('  ✓ drawable/ic_stat_aiva.png');
}

async function writeBrandColors() {
  const valuesDir = join(OUT, 'values');
  await mkdir(valuesDir, { recursive: true });
  await writeFile(join(valuesDir, 'colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splash_background">${BRAND_BG}</color>
</resources>
`);
  await writeFile(join(valuesDir, 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#00000000</color>
</resources>
`);
}

async function writeAdaptiveIconXml() {
  const anydpi = join(OUT, 'mipmap-anydpi-v26');
  await mkdir(anydpi, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  await writeFile(join(anydpi, 'ic_launcher.xml'), xml);
  await writeFile(join(anydpi, 'ic_launcher_round.xml'), xml);
  console.log('  ✓ adaptive icons (transparent bg + foreground PNG as-is)');
}

async function main() {
  const icon512Path = await resolveIcon512();
  const icon192Path = await resolveIcon192();
  console.log(`Android branding → ${OUT}`);
  console.log(`  512: ${icon512Path}`);
  console.log(`  192: ${icon192Path}`);
  await writeLauncherIcons(icon512Path, icon192Path);
  await writeSplashDrawable();
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await writeNotificationIcon(icon192Path);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
