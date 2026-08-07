/**
 * Android launcher icons — NutriPlan / aidiet pipeline (aidiet build-apk.yml).
 *
 * 1. process-brand-assets → frontend/icons/icon-512.png (transparent PNG, like icon-512x512.png)
 * 2. generate-android-apk-assets uses that tile ONLY (direct resize, no raw icon1)
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

/** NutriPlan CI: SAFE = SIZE * 2/3 */
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

const FRONTEND_ICONS = join(ROOT, 'frontend', 'icons');
const SOURCE_DIR = join(ROOT, 'brand-assets', 'source');

/** Processed launcher tile — same role as NutriPlan icon-512x512.png */
export const LAUNCHER_TILE_CANDIDATES = [
  join(FRONTEND_ICONS, 'icon-512.png'),
  join(SOURCE_DIR, 'icon-512.png'),
];

/** Raw exports for first-time brand processing only */
export const RAW_ICON_CANDIDATES = [
  join(SOURCE_DIR, 'icon1.png'),
  join(SOURCE_DIR, 'kasyico.png'),
  join(ROOT, 'PSX_20260805_210455.png'),
  join(SOURCE_DIR, 'PSX_20260805_210455.png'),
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

function isPinkGlow(r, g, b) {
  return r > 55 && r > g * 1.15 && r > b * 1.05;
}

/** True for export matte / card pixels (dark gray card, not robot visor). */
function isMattePixel(r, g, b, a, { lumaMax = 58 } = {}) {
  if (a < 12) return true;
  const max = Math.max(r, g, b);
  if (isPinkGlow(r, g, b)) return false;
  return max < lumaMax;
}

/**
 * Flood from image edges through transparent + dark matte — removes black/gray card
 * while keeping robot visor (not connected to outer matte through low-luma flood).
 */
export async function removeCardMatte(buf, { lumaMax = 58 } = {}) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const out = Buffer.from(data);
  const visited = new Uint8Array(w * h);
  const queue = [];

  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    const i = idx * 4;
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const a = out[i + 3];
    if (!isMattePixel(r, g, b, a, { lumaMax })) return;
    visited[idx] = 1;
    queue.push(idx);
  };

  for (let x = 0; x < w; x += 1) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }

  while (queue.length > 0) {
    const idx = queue.pop();
    const x = idx % w;
    const y = Math.floor(idx / w);
    const i = idx * 4;
    out[i + 3] = 0;
    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** Trim export, strip card matte, trim alpha — robot + glow only. */
export async function prepRawIconExport(input) {
  let buf = await sharp(input).ensureAlpha().png().toBuffer();
  try {
    buf = await sharp(buf).trim({ threshold: 32 }).png().toBuffer();
  } catch {
    /* ok */
  }
  buf = await removeCardMatte(buf);
  return trimAlphaArt(buf);
}

/**
 * Build canonical launcher tile (NutriPlan icon-512x512.png equivalent).
 * Transparent 512×512, artwork centered at natural size.
 */
export async function buildLauncherTile(input, size = 512) {
  const prepared = await prepRawIconExport(input);
  return sharp(prepared).resize(size, size, { fit: 'contain', background: TRANSPARENT });
}

export async function resolveLauncherTile() {
  for (const path of LAUNCHER_TILE_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      /* next */
    }
  }
  throw new Error(
    'Missing launcher tile. Run: node scripts/process-brand-assets.mjs',
  );
}

export async function resolveRawIconExport() {
  for (const path of RAW_ICON_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      /* next */
    }
  }
  throw new Error('Missing raw icon export (icon1.png or kasyico.png).');
}

/** @deprecated Use resolveLauncherTile */
export async function resolveMasterIcon() {
  return resolveLauncherTile();
}

/**
 * Legacy launcher — NutriPlan: convert ICON_SRC -resize SIZE (direct tile resize).
 */
export function renderLegacyLauncher(tileInput, size) {
  return sharp(tileInput).resize(size, size, { fit: 'inside', background: TRANSPARENT });
}

/**
 * Adaptive foreground — NutriPlan: xc:none + ICON_SRC resize SAFE + center composite.
 */
export async function renderAdaptiveForeground(tileInput, canvasSize) {
  const safe = Math.floor(canvasSize * SAFE_ZONE_RATIO);
  const scaled = await sharp(tileInput)
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

/** Notification mask from launcher tile. */
export async function renderNotificationMask(tileInput, size) {
  const resized = await sharp(tileInput)
    .resize(size, size, { fit: 'inside', background: TRANSPARENT })
    .ensureAlpha()
    .png()
    .toBuffer();
  return sharp(resized).extractChannel('alpha').png().toBuffer();
}

/** PWA tile generation alias */
export async function renderLauncherSource(input, size = 512) {
  return buildLauncherTile(input, size);
}

export const APK_BG = APP_WINDOW_BG;
export const APK_ICON_FILL = SAFE_ZONE_RATIO;
export const APK_FOREGROUND_FILL = SAFE_ZONE_RATIO;
