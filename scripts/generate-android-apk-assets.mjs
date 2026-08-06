#!/usr/bin/env node
/**
 * Android launcher icons from the transparent master artwork (no native splash).
 *
 * Ships ONLY pre-shaped circular legacy bitmaps (ic_launcher /
 * ic_launcher_round) and deletes every adaptive-icon resource, so launchers
 * that honor an app's own icon shape (MIUI/HyperOS, OneUI, EMUI...) show a
 * large round icon with transparent corners instead of a masked square tile.
 */
import { mkdir, writeFile, readFile, unlink, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  APP_WINDOW_BG,
  APK_ICON_BG,
  APK_CIRCLE_FILL,
  LEGACY_DP,
  DENSITY_SCALES,
  resolveMasterIcon,
  renderApkCircle,
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

    const size = Math.round(LEGACY_DP * scale);
    const buf = await renderApkCircle(masterPath, size)
      .then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    await writeFile(join(folder, 'ic_launcher.png'), buf);
    await writeFile(join(folder, 'ic_launcher_round.png'), buf);
    console.log(
      `  ✓ mipmap-${density}/ ${size}px circular (art ${Math.round(APK_CIRCLE_FILL * 100)}% of disc)`,
    );
  }
}

/**
 * Remove every adaptive-icon resource (Capacitor defaults and our own older
 * output). With no adaptive icon, launchers fall back to the pre-shaped
 * circular bitmaps above and cannot re-mask them into square tiles.
 */
async function removeAdaptiveIconResources(resDir) {
  await rm(join(resDir, 'mipmap-anydpi-v26'), { recursive: true, force: true });
  await unlink(join(resDir, 'drawable-v24', 'ic_launcher_foreground.xml')).catch(() => {});
  for (const [density] of DENSITY_SCALES) {
    for (const name of ['ic_launcher_foreground.png', 'ic_launcher_background.png']) {
      await unlink(join(resDir, `mipmap-${density}`, name)).catch(() => {});
    }
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

async function mirrorToAndroidRes() {
  for (const [density] of DENSITY_SCALES) {
    const srcDir = join(OUT, `mipmap-${density}`);
    const dstDir = join(ANDROID_RES, `mipmap-${density}`);
    await mkdir(dstDir, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
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
  await writeNotificationIcon(icon192Path);
  await removeAdaptiveIconResources(OUT);
  await removeAdaptiveIconResources(ANDROID_RES);
  console.log('  ✓ removed adaptive icon resources (circular legacy bitmaps only)');
  if (OUT.includes('android/app')) {
    await mirrorToAndroidRes();
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
