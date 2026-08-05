#!/usr/bin/env node
/**
 * Android launcher from icon1.png (transparent) + splash via WebView contain.
 */
import { mkdir, writeFile, readdir, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  renderAdaptiveForeground,
  renderLegacyLauncher,
  trimAlphaArt,
} from './lib/brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const ICON_CANDIDATES = [
  join(SOURCE_DIR, 'icon1.png'),
  join(ROOT, 'icon1.png'),
];

const BRAND_BG = '#050508';
/** Android adaptive safe zone — do not exceed or OEM masks crop the glow */
const ADAPTIVE_SAFE_FILL = 0.66;
const LEGACY_FILL = 0.78;

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

async function resolveIconSource() {
  for (const p of ICON_CANDIDATES) {
    if (await exists(p)) return p;
  }
  throw new Error('Missing icon1.png — add to brand-assets/source/ or repo root');
}

async function writeLauncherIcons(iconSrc) {
  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });

    const legacyBuf = await renderLegacyLauncher(iconSrc, size, {
      fill: LEGACY_FILL,
      bg: BRAND_BG,
    }).then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    const fgBuf = await renderAdaptiveForeground(iconSrc, size, {
      safeFill: ADAPTIVE_SAFE_FILL,
    }).then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);
    console.log(`  ✓ ${dir}/ic_launcher (fg safe ${Math.round(ADAPTIVE_SAFE_FILL * 100)}%)`);
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

async function writeNotificationIcon(iconSrc) {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  const trimmed = await trimAlphaArt(iconSrc);
  const buf = await sharp(trimmed)
    .resize(96, 96, { fit: 'inside' })
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
    <color name="ic_launcher_background">${BRAND_BG}</color>
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
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  await writeFile(join(anydpi, 'ic_launcher.xml'), xml);
  await writeFile(join(anydpi, 'ic_launcher_round.xml'), xml);
  console.log('  ✓ adaptive icons (dark bg + transparent foreground)');
}

async function main() {
  const iconSrc = await resolveIconSource();
  console.log(`Android branding → ${OUT}`);
  console.log(`  Icon: ${iconSrc}`);
  await writeLauncherIcons(iconSrc);
  await writeSplashDrawable();
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await writeNotificationIcon(iconSrc);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
