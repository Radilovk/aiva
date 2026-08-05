#!/usr/bin/env node
/**
 * Android launcher icons from PWA assets (no native splash).
 */
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { APK_BG, APK_ICON_FILL, renderApkForeground, renderApkLegacy } from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ANDROID_RES = join(ROOT, 'android-res');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const FRONTEND_ICONS = join(ROOT, 'frontend', 'icons');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const MIPMAP_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

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

async function writeLauncherIcons(icon512Path) {
  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });

    const fgBuf = await renderApkForeground(icon512Path, size)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());
    const legacyBuf = await renderApkLegacy(icon512Path, size)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);
    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), legacyBuf);
    console.log(`  ✓ ${dir}/ ${size}px (fg transparent ${Math.round(APK_ICON_FILL * 100)}%, legacy bg ${APK_BG})`);
  }
}

async function removeCapacitorDefaultVectors() {
  const vector = join(OUT, 'drawable-v24', 'ic_launcher_foreground.xml');
  try {
    await unlink(vector);
    console.log('  ✓ removed Capacitor default vector foreground');
  } catch {
    /* ok */
  }
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
  await writeFile(join(ANDROID_RES, 'drawable', 'ic_stat_aiva.png'), buf);
  console.log('  ✓ drawable/ic_stat_aiva.png');
}

async function writeBrandColors() {
  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="app_background">${APK_BG}</color>
</resources>
`;
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${APK_BG}</color>
</resources>
`;
  for (const valuesDir of [join(OUT, 'values'), join(ANDROID_RES, 'values')]) {
    await mkdir(valuesDir, { recursive: true });
    await writeFile(join(valuesDir, 'colors.xml'), colorsXml);
    await writeFile(join(valuesDir, 'ic_launcher_background.xml'), bgXml);
  }
}

async function writeAdaptiveIconXml() {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  for (const anydpi of [join(OUT, 'mipmap-anydpi-v26'), join(ANDROID_RES, 'mipmap-anydpi-v26')]) {
    await mkdir(anydpi, { recursive: true });
    await writeFile(join(anydpi, 'ic_launcher.xml'), xml);
    await writeFile(join(anydpi, 'ic_launcher_round.xml'), xml);
  }
  console.log(`  ✓ adaptive icons (transparent fg, bg ${APK_BG})`);
}

async function mirrorToAndroidRes() {
  for (const [dir] of MIPMAP_SIZES) {
    const srcDir = join(OUT, dir);
    const dstDir = join(ANDROID_RES, dir);
    await mkdir(dstDir, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const buf = await readFile(join(srcDir, name));
      await writeFile(join(dstDir, name), buf);
    }
  }
  console.log('  ✓ mirrored mipmaps → android-res/');
}

async function main() {
  const icon512Path = await resolveIcon512();
  const icon192Path = await resolveIcon192();
  console.log(`Android branding → ${OUT}`);
  console.log(`  master: ${icon512Path}`);
  await writeLauncherIcons(icon512Path);
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await writeNotificationIcon(icon192Path);
  await removeCapacitorDefaultVectors();
  if (OUT.includes('android/app')) {
    await mirrorToAndroidRes();
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
