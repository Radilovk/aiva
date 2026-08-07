/**
 * Android launcher icons — NutriPlan / aidiet pipeline.
 *
 * Source exports often include an opaque black rounded card; we strip it so only
 * robot + pink glow remain on transparency (like NutriPlan apple on transparent PNG).
 * Adaptive background #050508 comes from @color/ic_launcher_background.
 */
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimAlphaArt } from './brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APP_WINDOW_BG = '#050508';
export const APK_ICON_BG = '#050508';

/** 66.7% safe zone for adaptive foreground (Icon.md / NutriPlan). */
export const SAFE_ZONE_RATIO = 2 / 3;

export const LEGACY_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

export const ADAPTIVE_SIZES = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
];

export const ADAPTIVE_DP = 108;
export const LEGACY_DP = 48;

export const DENSITY_SCALES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/** Raw masters only — never derived frontend/icons outputs. */
export const MASTER_ICON_CANDIDATES = [
  join(ROOT, 'brand-assets', 'source', 'icon1.png'),
  join(ROOT, 'brand-assets', 'source', 'kasyico.png'),
  join(ROOT, 'brand-assets', 'source', 'icon-512.png'),
  join(ROOT, 'PSX_20260805_210455.png'),
  join(ROOT, 'brand-assets', 'source', 'PSX_20260805_210455.png'),
];

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

/**
 * Remove baked-in opaque black card from robot exports (keeps pink neon glow).
 * Without this, launchers show a small black rounded square inside the mask.
 */
export async function removeOpaqueMatte(buf, { lumaMax = 32, alphaMin = 12 } = {}) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const out = Buffer.from(data);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      const a = out[i + 3];
      if (a < alphaMin) continue;
      const max = Math.max(r, g, b);
      const isPinkGlow = r > 55 && r > g * 1.15 && r > b * 1.05;
      if (max < lumaMax && !isPinkGlow) {
        out[i + 3] = 0;
      }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Trim matte, strip black card, trim alpha bounds — canonical launcher artwork. */
export async function prepApkIconSource(input) {
  let buf = await sharp(input).ensureAlpha().png().toBuffer();
  try {
    buf = await sharp(buf).trim({ threshold: 32 }).png().toBuffer();
  } catch {
    /* no matte */
  }
  buf = await removeOpaqueMatte(buf);
  return trimAlphaArt(buf);
}

export async function resolveMasterIcon() {
  for (const path of MASTER_ICON_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      /* try next */
    }
  }
  throw new Error('No master icon found. Add brand-assets/source/icon1.png or icon-512.png.');
}

/** PWA / launcher tile — transparent PNG, artwork at natural size. */
export async function renderLauncherSource(input, size) {
  const prepared = await prepApkIconSource(input);
  return sharp(prepared).resize(size, size, { fit: 'contain', background: TRANSPARENT });
}

/** Legacy launcher — prepared art resized (NutriPlan: convert -resize). */
export async function renderLegacyLauncher(input, size) {
  const prepared = await prepApkIconSource(input);
  return sharp(prepared).resize(size, size, { fit: 'contain', background: TRANSPARENT });
}

/**
 * Adaptive foreground — prepared art scaled to 66.7% safe zone on transparent canvas.
 */
export async function renderAdaptiveForeground(input, canvasSize) {
  const prepared = await prepApkIconSource(input);
  const safe = Math.floor(canvasSize * SAFE_ZONE_RATIO);
  const scaled = await sharp(prepared)
    .resize(safe, safe, { fit: 'inside', background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: TRANSPARENT,
    },
  }).composite([{ input: scaled, gravity: 'center' }]);
}

/** Monochrome notification mask — alpha extract from prepared art. */
export async function renderNotificationMask(input, size) {
  const prepared = await prepApkIconSource(input);
  const resized = await sharp(prepared)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp(resized).extractChannel('alpha').png().toBuffer();
}

/**
 * @deprecated Opaque maskable tile — makes icon look small on launchers.
 */
export async function renderMaskableSquare(input, size = 512) {
  const trimmed = await prepApkIconSource(input);
  const safe = Math.floor(size * SAFE_ZONE_RATIO);
  const logo = await sharp(trimmed)
    .resize(safe, safe, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: parseBg(APK_ICON_BG),
    },
  }).composite([{ input: logo, gravity: 'center' }]);
}

/** @deprecated Alias */
export async function buildMaskableMaster(input, size = 512) {
  return renderMaskableSquare(input, size);
}

export const APK_BG = APP_WINDOW_BG;
export const APK_ICON_FILL = SAFE_ZONE_RATIO;
export const APK_FOREGROUND_FILL = SAFE_ZONE_RATIO;
