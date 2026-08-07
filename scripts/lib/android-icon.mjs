/**
 * Android launcher icons — NutriPlan / aidiet pipeline.
 *
 * Source PNG has transparent corners; artwork is large on the canvas.
 * Legacy: direct resize of source (transparent sides preserved).
 * Adaptive: foreground at 66.7% safe zone on transparent 108dp canvas;
 *           background via @color/ic_launcher_background (#050508).
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

/**
 * PWA / launcher source tile — transparent canvas, artwork at natural size (NutriPlan icon-512x512.png).
 */
export async function renderLauncherSource(input, size) {
  const prepared = await prepApkIconSource(input);
  return sharp(prepared).resize(size, size, { fit: 'contain', background: TRANSPARENT });
}

/** Legacy launcher — direct resize, transparent corners (NutriPlan: convert -resize). */
export function renderLegacyLauncher(input, size) {
  return sharp(input).resize(size, size, { fit: 'contain', background: TRANSPARENT });
}

/**
 * Adaptive foreground — transparent canvas; whole source scaled to 66.7% safe zone.
 * ImageMagick: xc:none + resize SAFE + gravity center.
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

/** Monochrome notification mask — alpha extract. */
export async function renderNotificationMask(input, size) {
  const resized = await sharp(input)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp(resized).extractChannel('alpha').png().toBuffer();
}

/**
 * @deprecated Opaque maskable tile — not used for APK (makes icon look small).
 * NutriPlan uses transparent PNG + @color/ic_launcher_background.
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
