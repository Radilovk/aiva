/**
 * Android launcher icons — adaptive (API 26+) + legacy (API ≤ 25).
 *
 * Spec: https://developer.android.com/develop/ui/views/launch/icon_design_adaptive
 * - Adaptive canvas is 108 dp; launchers mask it to their own shape and show
 *   the central ~72 dp, so layers must be rendered at 108 dp per density.
 * - Background layer must be opaque full-bleed (Android does not allow a
 *   transparent adaptive background) — we use the dark brand color so the
 *   artwork reads as one large icon instead of a logo on a white tile.
 * - Foreground layer: transparent, artwork inside the 72 dp visible zone.
 * - Legacy bitmaps (Android 5–7.1 launchers): transparent PNG rendered as-is
 *   by the launcher — big artwork, no square tile.
 */
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimAlphaArt } from './brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

/** App window / WebView chrome — stays dark. */
export const APP_WINDOW_BG = '#050508';

/** Adaptive icon background — dark brand full-bleed (no white tile). */
export const APK_ICON_BG = '#050508';

/** Google visible zone = 72 dp of the 108 dp adaptive canvas. */
export const APK_FOREGROUND_FILL = 72 / 108;

/** Legacy launcher bitmaps: artwork fills most of the tile, alpha kept. */
export const APK_LEGACY_FILL = 0.9;

/** Density scales shared by every mipmap bucket. */
export const DENSITY_SCALES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/** Adaptive layers are 108 dp, legacy launcher icons 48 dp. */
export const ADAPTIVE_DP = 108;
export const LEGACY_DP = 48;

/**
 * Master launcher artwork — must keep its alpha channel. Derived outputs
 * (frontend/icons/*) are never used as a source.
 */
export const MASTER_ICON_CANDIDATES = [
  join(ROOT, 'brand-assets', 'source', 'icon-512.png'),
  join(ROOT, 'PSX_20260805_210455.png'),
  join(ROOT, 'brand-assets', 'source', 'PSX_20260805_210455.png'),
];

export async function resolveMasterIcon() {
  for (const p of MASTER_ICON_CANDIDATES) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error('Missing launcher icon source (brand-assets/source/icon-512.png or PSX_20260805_210455.png)');
}

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

async function fitLogo(input, size, fill) {
  const trimmed = await trimAlphaArt(input);
  const inner = Math.max(1, Math.round(size * fill));
  const resized = await sharp(trimmed)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.floor((size - meta.width) / 2);
  const top = Math.floor((size - meta.height) / 2);
  return { resized, left, top };
}

/**
 * Opaque full-bleed background layer (required by AdaptiveIconDrawable).
 * Radial neon glow sampled from the icon1.png master art: bright magenta
 * behind the robot fading to near-black at the tile edges, so the launcher
 * icon looks exactly like the original artwork instead of a flat tile.
 */
export function renderApkBackground(size) {
  const c = size / 2;
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#E3AEDC"/>
      <stop offset="45%" stop-color="#7A3A6C"/>
      <stop offset="78%" stop-color="#1E0C1A"/>
      <stop offset="100%" stop-color="${APK_ICON_BG}"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="${APK_ICON_BG}"/>
  <circle cx="${c}" cy="${c}" r="${c}" fill="url(#glow)"/>
</svg>`,
  );
  return sharp(svg).ensureAlpha().flatten({ background: parseBg(APK_ICON_BG) });
}

/** Transparent foreground — artwork centered in the 72 dp visible zone. */
export async function renderApkForeground(input, size, { fill = APK_FOREGROUND_FILL } = {}) {
  const { resized, left, top } = await fitLogo(input, size, fill);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: resized, left, top }]);
}

/**
 * Legacy launcher / roundIcon bitmaps (API ≤ 25) — transparent, artwork
 * nearly full-bleed. Launchers without adaptive masks show it as-is.
 */
export async function renderApkLegacy(input, size, { fill = APK_LEGACY_FILL } = {}) {
  const { resized, left, top } = await fitLogo(input, size, fill);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: resized, left, top }]);
}

export function renderApkRound(input, size) {
  return renderApkLegacy(input, size);
}

/** Flatten adaptive layers on the brand background — preview / Play Store. */
export async function renderApkFlat(input, size) {
  const bgBuf = await renderApkBackground(size).png().toBuffer();
  const fgBuf = await (await renderApkForeground(input, size)).png().toBuffer();
  return sharp(bgBuf).composite([{ input: fgBuf }]);
}

// Back-compat aliases used by older scripts
export const APK_BG = APP_WINDOW_BG;
export const APK_ICON_FILL = APK_FOREGROUND_FILL;
export const APK_ROUND_FILL = APK_LEGACY_FILL;
