#!/usr/bin/env node
/**
 * Generate Android launcher icons + native splash into android/app/src/main/res.
 * Uses alpha-trimmed art so adaptive icons fill the squircle (no tiny circle in white box).
 */
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderIconSquare } from './lib/kasy-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ICON_SRC = join(ROOT, 'brand-assets', 'source', 'kasyico.png');
const ICON_FALLBACK = join(ROOT, 'frontend', 'icons', 'icon-512.png');
const SPLASH_SRC = join(ROOT, 'android-res', 'drawable', 'splash.png');
const NOTIF_SRC = join(ROOT, 'frontend', 'icons', 'ic-stat-notification.png');

const BRAND_BG = '#050508';
/** Foreground fill — 84% uses Android adaptive safe zone well for circular art */
const FOREGROUND_FILL = 0.84;
/** Legacy launcher — slightly larger on dark bg */
const LEGACY_FILL = 0.88;

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

async function exists(path) {
  try {
    await import('node:fs/promises').then((fs) => fs.access(path));
    return true;
  } catch {
    return false;
  }
}

async function resolveIconSource() {
  if (await exists(ICON_SRC)) return ICON_SRC;
  if (await exists(join(ROOT, 'kasyico.png'))) return join(ROOT, 'kasyico.png');
  return ICON_FALLBACK;
}

async function writeLauncherIcons(iconInput) {
  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });

    const legacyBuf = await renderIconSquare(iconInput, {
      size,
      fill: LEGACY_FILL,
      transparent: false,
      bg: BRAND_BG,
    }).then((p) => p.toBuffer());

    const fgBuf = await renderIconSquare(iconInput, {
      size,
      fill: FOREGROUND_FILL,
      transparent: true,
    }).then((p) => p.toBuffer());

    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);
    console.log(`  ✓ ${dir}/ic_launcher + foreground (${size}px)`);
  }
}

async function writeSplashAssets() {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  const fallback = await sharp(SPLASH_SRC).png().toBuffer();
  await writeFile(join(OUT, 'drawable', 'splash.png'), fallback);
  console.log('  ✓ drawable/splash.png');

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

async function writeBrandColors() {
  const valuesDir = join(OUT, 'values');
  await mkdir(valuesDir, { recursive: true });
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splash_background">${BRAND_BG}</color>
</resources>
`;
  await writeFile(join(valuesDir, 'colors.xml'), colors);
  const launcherBg = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BRAND_BG}</color>
</resources>
`;
  await writeFile(join(valuesDir, 'ic_launcher_background.xml'), launcherBg);
  console.log('  ✓ values/colors.xml + ic_launcher_background.xml');
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
  const iconInput = await resolveIconSource();
  console.log(`Android branding → ${OUT}`);
  console.log(`  Icon source: ${iconInput}`);
  await writeLauncherIcons(iconInput);
  await writeSplashAssets();
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await copyNotificationIcon();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
