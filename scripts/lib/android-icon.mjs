/**
 * Android launcher icon — pre-shaped circular bitmap, no adaptive layers.
 *
 * The app intentionally ships only legacy `ic_launcher` / `ic_launcher_round`
 * bitmaps: a circular neon-glow disc with the robot artwork and transparent
 * corners. Launchers that honor an app's own icon shape (MIUI/HyperOS,
 * OneUI, EMUI and most OEM launchers) display it as-is — a large round icon
 * instead of the artwork shrunk into a launcher-masked square tile.
 * Launchers that force their own mask (e.g. Pixel) plate the bitmap; that
 * trade-off is chosen deliberately over an adaptive square.
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

/** Darkest edge of the icon disc — matches the app background. */
export const APK_ICON_BG = '#050508';

/** Artwork diameter relative to the disc (widest at mid-height, stays inside). */
export const APK_CIRCLE_FILL = 0.88;

/** Density scales shared by every mipmap bucket (48 dp launcher icons). */
export const DENSITY_SCALES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

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

/**
 * Neon-glow disc sampled from the icon1.png master art: bright magenta
 * behind the robot fading to near-black at the rim, transparent outside.
 */
function glowDiscSvg(size) {
  const c = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#E3AEDC"/>
      <stop offset="45%" stop-color="#7A3A6C"/>
      <stop offset="78%" stop-color="#1E0C1A"/>
      <stop offset="100%" stop-color="${APK_ICON_BG}"/>
    </radialGradient>
  </defs>
  <circle cx="${c}" cy="${c}" r="${c}" fill="url(#glow)"/>
</svg>`,
  );
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

/** The launcher icon: glow disc + robot, transparent corners. */
export async function renderApkCircle(input, size, { fill = APK_CIRCLE_FILL } = {}) {
  const disc = await sharp(glowDiscSvg(size)).png().toBuffer();
  const { resized, left, top } = await fitLogo(input, size, fill);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: disc }, { input: resized, left, top }]);
}

export function renderApkLegacy(input, size, options = {}) {
  return renderApkCircle(input, size, options);
}

export function renderApkRound(input, size, options = {}) {
  return renderApkCircle(input, size, options);
}

// Back-compat aliases used by older scripts
export const APK_BG = APP_WINDOW_BG;
export const APK_ICON_FILL = APK_CIRCLE_FILL;
export const APK_ROUND_FILL = APK_CIRCLE_FILL;
