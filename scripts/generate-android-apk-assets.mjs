#!/usr/bin/env node
/**
 * Android launcher icons from the transparent master artwork (no native splash).
 *
 * Per density bucket:
 *   - ic_launcher_background.png / ic_launcher_foreground.png — adaptive
 *     layers at 108 dp (dark full-bleed bg + artwork in the 72 dp zone)
 *   - ic_launcher.png / ic_launcher_round.png — legacy 48 dp bitmaps,
 *     transparent, artwork nearly full-bleed (Android ≤ 7.1 launchers)
 */
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  APP_WINDOW_BG,
  APK_ICON_BG,
  APK_FOREGROUND_FILL,
  APK_LEGACY_FILL,
  ADAPTIVE_DP,
  LEGACY_DP,
  DENSITY_SCALES,
  resolveMasterIcon,
  renderApkBackground,
  renderApkForeground,
  renderApkLegacy,
  renderApkRound,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ANDROID_RES = join(ROOT, 'android-res');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function exists(path) {
  try {
    await import('node:fs/promises').then((fs) => fs.access(path));
    return true;
  } catch {
    return false;
  }
}

async function resolveIcon192() {
  const candidates = [
    join(SOURCE_DIR, 'icon-192.png'),
    join(ROOT, 'PSX_20260805_210411.png'),
    join(SOURCE_DIR, 'PSX_20260805_210411.png'),
  ];
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  throw new Error('Missing icon-192.png / PSX_20260805_210411.png');
}

async function writeLauncherIcons(masterPath) {
  for (const [density, scale] of DENSITY_SCALES) {
    const folder = join(OUT, `mipmap-${density}`);
    await mkdir(folder, { recursive: true });

    const adaptiveSize = Math.round(ADAPTIVE_DP * scale);
    const legacySize = Math.round(LEGACY_DP * scale);

    const bgBuf = await renderApkBackground(adaptiveSize).png({ compressionLevel: 9 }).toBuffer();
    const fgBuf = await renderApkForeground(masterPath, adaptiveSize)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());
    const legacyBuf = await renderApkLegacy(masterPath, legacySize)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());
    const roundBuf = await renderApkRound(masterPath, legacySize)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    await writeFile(join(folder, 'ic_launcher_background.png'), bgBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);
    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), roundBuf);
    console.log(
      `  ✓ mipmap-${density}/ adaptive ${adaptiveSize}px (bg ${APK_ICON_BG}, fg ${Math.round(APK_FOREGROUND_FILL * 100)}%), legacy ${legacySize}px transparent (${Math.round(APK_LEGACY_FILL * 100)}%)`,
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

async function writeNotificationIcon(icon192Path) {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  await mkdir(join(ANDROID_RES, 'drawable'), { recursive: true });
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
    <color name="app_background">${APP_WINDOW_BG}</color>
</resources>
`;
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${APK_ICON_BG}</color>
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
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  for (const anydpi of [join(OUT, 'mipmap-anydpi-v26'), join(ANDROID_RES, 'mipmap-anydpi-v26')]) {
    await mkdir(anydpi, { recursive: true });
    await writeFile(join(anydpi, 'ic_launcher.xml'), xml);
    await writeFile(join(anydpi, 'ic_launcher_round.xml'), xml);
  }
  console.log(`  ✓ adaptive icons (bitmap bg ${APK_ICON_BG}, fg safe zone)`);
}

async function mirrorToAndroidRes() {
  for (const [density] of DENSITY_SCALES) {
    const srcDir = join(OUT, `mipmap-${density}`);
    const dstDir = join(ANDROID_RES, `mipmap-${density}`);
    await mkdir(dstDir, { recursive: true });
    for (const name of [
      'ic_launcher_background.png',
      'ic_launcher.png',
      'ic_launcher_round.png',
      'ic_launcher_foreground.png',
    ]) {
      const buf = await readFile(join(srcDir, name));
      await writeFile(join(dstDir, name), buf);
    }
  }
  console.log('  ✓ mirrored mipmaps → android-res/');
}

async function main() {
  const masterPath = await resolveMasterIcon();
  const icon192Path = await resolveIcon192();
  console.log(`Android branding → ${OUT}`);
  console.log(`  master: ${masterPath}`);
  await writeLauncherIcons(masterPath);
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
