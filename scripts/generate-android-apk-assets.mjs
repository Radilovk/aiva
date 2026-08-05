#!/usr/bin/env node
/**
 * Android launcher + splash from frontend/icons/brand.webp + splash.webp
 */
import { mkdir, writeFile, readdir, rm, unlink, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

const OUT = process.argv[2] || join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ICON_SRC = join(ROOT, 'frontend', 'icons', 'brand.webp');
const SPLASH_SRC = join(ROOT, 'frontend', 'icons', 'splash.webp');

const BRAND_BG = '#050508';

const MIPMAP_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

/** Centered bitmap on solid bg — no crop, no tile, no stretch */
const SPLASH_LAYER_XML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background"/>
    <item>
        <bitmap
            android:gravity="center"
            android:src="@drawable/splash_art" />
    </item>
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

async function writeLauncherIcons(iconInput) {
  for (const [dir, size] of MIPMAP_SIZES) {
    const folder = join(OUT, dir);
    await mkdir(folder, { recursive: true });

    const legacyBuf = await sharp(iconInput)
      .resize(size, size, { fit: 'contain', background: BRAND_BG })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const fgBuf = await sharp(iconInput)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await writeFile(join(folder, 'ic_launcher.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_round.png'), legacyBuf);
    await writeFile(join(folder, 'ic_launcher_foreground.png'), fgBuf);
    console.log(`  ✓ ${dir}/ic_launcher (${size}px)`);
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
      console.log(`  ✓ removed ${entry.name}/`);
    }
  }
}

async function writeSplashAssets() {
  if (!await exists(SPLASH_SRC)) {
    throw new Error(`Missing ${SPLASH_SRC} — run node scripts/process-brand-assets.mjs`);
  }

  const androidResDrawable = join(ROOT, 'android-res', 'drawable');
  await mkdir(androidResDrawable, { recursive: true });
  await mkdir(join(OUT, 'drawable'), { recursive: true });

  const artBuf = await readFile(SPLASH_SRC);
  await writeFile(join(androidResDrawable, 'splash_art.webp'), artBuf);
  await writeFile(join(OUT, 'drawable', 'splash_art.webp'), artBuf);
  await writeFile(join(androidResDrawable, 'splash.xml'), SPLASH_LAYER_XML);
  await writeFile(join(OUT, 'drawable', 'splash.xml'), SPLASH_LAYER_XML);

  for (const legacy of ['splash.png', 'splash.webp']) {
    for (const dir of [androidResDrawable, join(OUT, 'drawable')]) {
      try {
        await unlink(join(dir, legacy));
      } catch {
        /* ok */
      }
    }
  }
  console.log('  ✓ drawable/splash.xml + splash_art.webp (splash.webp, centered)');

  await removeDensitySplashes();
}

async function writeNotificationIcon(iconInput) {
  await mkdir(join(OUT, 'drawable'), { recursive: true });
  const buf = await sharp(iconInput)
    .resize(96, 96, { fit: 'contain', background: BRAND_BG })
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
  console.log('  ✓ adaptive icons');
}

async function main() {
  if (!await exists(ICON_SRC)) {
    throw new Error(`Missing ${ICON_SRC} — run node scripts/process-brand-assets.mjs`);
  }
  console.log(`Android branding → ${OUT}`);
  await writeLauncherIcons(ICON_SRC);
  await writeSplashAssets();
  await writeBrandColors();
  await writeAdaptiveIconXml();
  await writeNotificationIcon(ICON_SRC);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
