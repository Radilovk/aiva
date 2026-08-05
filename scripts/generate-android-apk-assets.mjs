#!/usr/bin/env node
/**
 * Generate Android launcher icons + native splash into android/app/src/main/res.
 * Splash: kasyspl.png (your upload). Icons: kasyico.png with larger safe-zone fill.
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
const SPLASH_FALLBACK = join(ROOT, 'android-res', 'drawable', 'splash.png');
const NOTIF_SRC = join(ROOT, 'frontend', 'icons', 'ic-stat-notification.png');

const BRAND_BG = '#050508';
/** Larger fill — adaptive icon safe zone is ~66%; larger values get masked/cropped */
const FOREGROUND_FILL = 0.66;
const LEGACY_FILL = 0.92;

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
  const candidates = [
    ICON_SRC,
    join(ROOT, 'kasyico.png'),
    join(ROOT, 'brand-assets', 'package-a', 'kasyico.png'),
    ICON_FALLBACK,
  ];
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  return ICON_FALLBACK;
}

async function resolveSplashSource() {
  const candidates = [
    join(ROOT, 'kasyspl.png'),
    join(ROOT, 'brand-assets', 'source', 'kasyspl.png'),
    join(ROOT, 'brand-assets', 'package-a', 'kasyspl.png'),
    join(ROOT, 'frontend', 'icons', 'pack-a', 'splash-android.png'),
    SPLASH_FALLBACK,
  ];
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  return SPLASH_FALLBACK;
}

function splashPipeline(input, w, h) {
  return sharp(input)
    .resize(w, h, {
      fit: 'cover',
      position: 'north',
    })
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 80 });
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

async function writeSplashAssets(splashInput) {
  const androidResDrawable = join(ROOT, 'android-res', 'drawable');
  await mkdir(androidResDrawable, { recursive: true });
  await mkdir(join(OUT, 'drawable'), { recursive: true });

  const baseBuf = await splashPipeline(splashInput, 720, 1280).toBuffer();
  await writeFile(join(androidResDrawable, 'splash.png'), baseBuf);
  await writeFile(join(OUT, 'drawable', 'splash.png'), baseBuf);
  console.log('  ✓ drawable/splash.png (kasyspl, cover top)');

  for (const [dir, w, h] of SPLASH_PORT) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });
    const buf = await splashPipeline(splashInput, w, h).toBuffer();
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
  const splashInput = await resolveSplashSource();
  console.log(`Android branding → ${OUT}`);
  console.log(`  Icon source: ${iconInput}`);
  console.log(`  Splash source: ${splashInput}`);
  await writeLauncherIcons(iconInput);
  await writeSplashAssets(splashInput);
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await copyNotificationIcon();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
