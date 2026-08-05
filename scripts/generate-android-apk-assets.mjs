#!/usr/bin/env node
/**
 * Android launcher + splash from brand.jpg (trimmed) + splash.webp (web overlay).
 * Native cold start: solid bg only. Splash image = CSS object-fit:contain in index.html.
 */
import { mkdir, writeFile, readdir, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderSquareIcon } from './lib/brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');
const BRAND_CANDIDATES = [
  join(SOURCE_DIR, 'brand.jpg'),
  join(ROOT, 'brand.jpg'),
  join(ROOT, 'frontend', 'icons', 'brand.webp'),
];

const BRAND_BG = '#050508';
const LEGACY_FILL = 0.92;
const FOREGROUND_FILL = 0.88;

const MIPMAP_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

/** Solid color only — bitmap splash crops on OEM skins; WebView uses CSS contain */
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

async function resolveBrandSource() {
  for (const p of BRAND_CANDIDATES) {
    if (await exists(p)) return p;
  }
  throw new Error('Missing brand source — run node scripts/process-brand-assets.mjs');
}

async function trimArt(input) {
  try {
    return await sharp(input).trim({ threshold: 18 }).toBuffer();
  } catch {
    return sharp(input).toBuffer();
  }
}

async function writeLauncherIcons(brandSrc) {
  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });

    const legacyBuf = await renderSquareIcon(brandSrc, {
      size,
      fill: LEGACY_FILL,
      transparent: false,
      bg: BRAND_BG,
    }).then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    const fgBuf = await renderSquareIcon(brandSrc, {
      size,
      fill: FOREGROUND_FILL,
      transparent: true,
    }).then((p) => p.png({ compressionLevel: 9 }).toBuffer());

    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);
    console.log(`  ✓ ${dir}/ic_launcher (${size}px, fill ${Math.round(LEGACY_FILL * 100)}%)`);
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
  console.log('  ✓ drawable/splash.xml (solid bg — image via WebView contain)');
  await removeDensitySplashes();
}

async function writeNotificationIcon(brandSrc) {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  const buf = await renderSquareIcon(brandSrc, {
    size: 96,
    fill: 0.9,
    transparent: false,
    bg: BRAND_BG,
  }).then((p) => p.grayscale().normalize().png({ compressionLevel: 9 }).toBuffer());
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
</adaptive-icon>
`;
  await writeFile(join(anydpi, 'ic_launcher.xml'), xml);
  await writeFile(join(anydpi, 'ic_launcher_round.xml'), xml);
  console.log('  ✓ adaptive icons');
}

async function main() {
  const brandSrc = await resolveBrandSource();
  console.log(`Android branding → ${OUT}`);
  console.log(`  Brand: ${brandSrc}`);
  await writeLauncherIcons(brandSrc);
  await writeSplashDrawable();
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await writeNotificationIcon(brandSrc);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
