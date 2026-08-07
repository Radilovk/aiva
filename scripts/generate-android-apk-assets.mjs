#!/usr/bin/env node
/**
 * Android launcher icons — NutriPlan / Icon.md pipeline (no native splash).
 */
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  APP_WINDOW_BG,
  APK_ICON_BG,
  SAFE_ZONE_RATIO,
  LEGACY_SIZES,
  ADAPTIVE_SIZES,
  renderLegacyLauncher,
  renderAdaptiveForeground,
  renderNotificationMask,
  resolveMasterIcon,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ANDROID_RES = join(ROOT, 'android-res');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');

async function writeLauncherIcons(icon512Path) {
  const legacyByDir = new Map(LEGACY_SIZES);
  const adaptiveByDir = new Map(ADAPTIVE_SIZES);

  for (const [dir] of LEGACY_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });
    const legacySize = legacyByDir.get(dir);
    const adaptiveSize = adaptiveByDir.get(dir);

    const legacyBuf = await renderLegacyLauncher(icon512Path, legacySize)
      .png({ compressionLevel: 9 })
      .toBuffer();
    const fgBuf = await renderAdaptiveForeground(icon512Path, adaptiveSize)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);

    // Remove stale bitmap background if present from older pipeline
    try {
      await unlink(join(folder, 'ic_launcher_background.png'));
    } catch {
      /* ok */
    }

    console.log(
      `  ✓ ${dir}/ legacy ${legacySize}px, adaptive fg ${adaptiveSize}px (${Math.round(SAFE_ZONE_RATIO * 100)}% safe)`,
    );
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

async function writeNotificationIcons(icon512Path) {
  const notifSizes = [
    ['drawable-mdpi', 24],
    ['drawable-hdpi', 36],
    ['drawable-xhdpi', 48],
    ['drawable-xxhdpi', 72],
    ['drawable-xxxhdpi', 96],
  ];
  for (const [dir, size] of notifSizes) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });
    const buf = await renderNotificationMask(icon512Path, size);
    await writeFile(join(folder, 'ic_stat_aiva.png'), buf);
  }
  const legacy = await renderNotificationMask(icon512Path, 96);
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  await writeFile(join(OUT, 'drawable', 'ic_stat_aiva.png'), legacy);
  await mkdir(join(ANDROID_RES, 'drawable'), { recursive: true });
  await writeFile(join(ANDROID_RES, 'drawable', 'ic_stat_aiva.png'), legacy);
  console.log('  ✓ drawable-*/ic_stat_aiva.png (alpha mask, Icon.md)');
}

async function writeBrandColors() {
  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="app_background">${APP_WINDOW_BG}</color>
    <color name="ic_launcher_background">${APK_ICON_BG}</color>
</resources>
`;
  for (const valuesDir of [join(OUT, 'values'), join(ANDROID_RES, 'values')]) {
    await mkdir(valuesDir, { recursive: true });
    await writeFile(join(valuesDir, 'colors.xml'), colorsXml);
    try {
      await unlink(join(valuesDir, 'ic_launcher_background.xml'));
    } catch {
      /* ok */
    }
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
  console.log(`  ✓ adaptive icons (@color/bg ${APK_ICON_BG}, fg mipmap)`);
}

async function mirrorToAndroidRes() {
  for (const [dir] of LEGACY_SIZES) {
    const srcDir = join(OUT, dir);
    const dstDir = join(ANDROID_RES, dir);
    await mkdir(dstDir, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const buf = await readFile(join(srcDir, name));
      await writeFile(join(dstDir, name), buf);
    }
    try {
      await unlink(join(dstDir, 'ic_launcher_background.png'));
    } catch {
      /* ok */
    }
  }
  console.log('  ✓ mirrored mipmaps → android-res/');
}

async function main() {
  const icon512Path = await resolveMasterIcon();
  console.log(`Android branding → ${OUT}`);
  console.log(`  master: ${icon512Path}`);
  await writeLauncherIcons(icon512Path);
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await writeNotificationIcons(icon512Path);
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
