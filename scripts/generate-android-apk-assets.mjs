#!/usr/bin/env node
/**
 * Generate Android launcher icons + native splash into android/app/src/main/res.
 * Run after `npx cap add android` in CI or locally:
 *   node scripts/generate-android-apk-assets.mjs [android/app/src/main/res]
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ICON_SRC = join(ROOT, 'frontend', 'icons', 'icon-512.png');
const SPLASH_SRC = join(ROOT, 'android-res', 'drawable', 'splash.png');
const NOTIF_SRC = join(ROOT, 'frontend', 'icons', 'ic-stat-notification.png');

const MIPMAP_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

const SPLASH_PORT = [
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 1080, 1920],
  ['drawable-port-xxxhdpi', 1440, 2560],
];

async function writeLauncherIcons() {
  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });
    const buf = await sharp(ICON_SRC)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(join(folder, 'ic_launcher.png'), buf);
    await writeFile(join(folder, 'ic_launcher_round.png'), buf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), buf);
    console.log(`  ✓ ${dir}/ic_launcher (${size}px)`);
  }
}

async function writeSplashAssets() {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  const fallback = await sharp(SPLASH_SRC).png().toBuffer();
  await writeFile(join(OUT, 'drawable', 'splash.png'), fallback);
  console.log(`  ✓ drawable/splash.png`);

  for (const [dir, w, h] of SPLASH_PORT) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });
    const buf = await sharp(SPLASH_SRC)
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    await writeFile(join(folder, 'splash.png'), buf);
    console.log(`  ✓ ${dir}/splash.png (${w}x${h})`);
  }
}

async function writeColors() {
  const valuesDir = join(OUT, 'values');
  await mkdir(valuesDir, { recursive: true });
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splash_background">#050508</color>
    <color name="ic_launcher_background">#050508</color>
</resources>
`;
  await writeFile(join(valuesDir, 'colors.xml'), colors);
  console.log('  ✓ values/colors.xml');
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
  console.log('  ✓ mipmap-anydpi-v26 adaptive icons');
}

async function copyNotificationIcon() {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  await copyFile(NOTIF_SRC, join(OUT, 'drawable', 'ic_stat_aiva.png'));
  console.log('  ✓ drawable/ic_stat_aiva.png');
}

async function main() {
  console.log(`Android branding → ${OUT}`);
  await writeLauncherIcons();
  await writeSplashAssets();
  await writeColors();
  await writeAdaptiveIconXml();
  await copyNotificationIcon();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
