/**
 * Android launcher icons — NutriPlan / Icon.md pipeline.
 *
 * Legacy: direct resize of maskable master PNG.
 * Adaptive: foreground at 80% safe zone on 108dp canvas (per density),
 *           background via @color/ic_launcher_background.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimAlphaArt } from './brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APP_WINDOW_BG = '#050508';
/** Adaptive icon background — matches maskable master tile (NutriPlan uses #042F2E). */
export const APK_ICON_BG = '#050508';

/** 80% safe zone — large square launcher fill; fg/bg both #050508 so circle clip is invisible. */
export const SAFE_ZONE_RATIO = 0.8;

export const LEGACY_SIZES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

/** Adaptive layers are 108dp × density multiplier — NOT legacy launcher sizes. */
export const ADAPTIVE_SIZES = [
  ['mipmap-mdpi', 108],
  ['mipmap-hdpi', 162],
  ['mipmap-xhdpi', 216],
  ['mipmap-xxhdpi', 324],
  ['mipmap-xxxhdpi', 432],
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

/** Strip flattened black matte from robot exports. */
export async function prepApkIconSource(input) {
  let buf = await sharp(input).ensureAlpha().png().toBuffer();
  try {
    buf = await sharp(buf).trim({ threshold: 32 }).png().toBuffer();
  } catch {
    /* no matte */
  }
  return trimAlphaArt(buf);
}

/**
 * Maskable master PNG (512×512): brand bg + logo in 66.7% safe zone.
 * Used as single source for PWA + APK (Icon.md).
 */
export async function buildMaskableMaster(input, size = 512) {
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

/** Legacy launcher — direct resize, no extra overlay (Icon.md). */
export function renderLegacyLauncher(input, size) {
  return sharp(input).resize(size, size, { fit: 'contain', background: parseBg(APK_ICON_BG) });
}

/**
 * Adaptive foreground — transparent canvas, master scaled to 66.7% safe zone.
 * ImageMagick equivalent: xc:none + resize SAFE + gravity center.
 */
export async function renderAdaptiveForeground(input, canvasSize) {
  const safe = Math.floor(canvasSize * SAFE_ZONE_RATIO);
  const scaled = await sharp(input)
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

/** Monochrome notification mask — alpha extract (Icon.md). */
export async function renderNotificationMask(input, size) {
  const resized = await sharp(input)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp(resized).extractChannel('alpha').png().toBuffer();
}

// Back-compat aliases
export const APK_BG = APP_WINDOW_BG;
export const APK_ICON_FILL = SAFE_ZONE_RATIO;
export const APK_FOREGROUND_FILL = SAFE_ZONE_RATIO;
