/**
 * Android adaptive icons — Google 108dp layers, OEM-safe (MIUI/HyperOS, OneUI, etc.).
 *
 * Spec: https://developer.android.com/develop/ui/views/launch/icon_design_adaptive
 * - Background: opaque, full-bleed 108×108 dp (fills launcher mask)
 * - Foreground: transparent outside logo; logo ~72 dp visible zone
 * - Legacy/round bitmaps: pre-composited for install UI & API < 26
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimAlphaArt } from './brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

/** App window / WebView chrome — stays dark. */
export const APP_WINDOW_BG = '#050508';

/** Launcher icon background — light full-bleed like Opera/Chrome/Badoo on OEM launchers. */
export const APK_ICON_BG = '#FFFFFF';

/** Google visible zone = 72 dp / 108 dp. Round/install screens use legacy composite. */
export const APK_FOREGROUND_FILL = 72 / 108;
export const APK_ROUND_FILL = 0.78;

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

/** Strip flattened black matte; keep robot visor/joints intact. */
export async function prepApkIconSource(input) {
  let buf = await sharp(input).ensureAlpha().png().toBuffer();
  try {
    buf = await sharp(buf).trim({ threshold: 32 }).png().toBuffer();
  } catch {
    /* no matte to trim */
  }
  return trimAlphaArt(buf);
}

async function fitLogo(input, size, fill) {
  const trimmed = await prepApkIconSource(input);
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

/** Opaque full-bleed background layer (required by AdaptiveIconDrawable). */
export function renderApkBackground(size) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: parseBg(APK_ICON_BG),
    },
  });
}

/** Transparent foreground — only the robot; OS background shows through corners. */
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

/** Legacy + roundIcon bitmaps — pre-composited tile for install UI & API < 26. */
export async function renderApkLegacy(input, size, { fill = APK_FOREGROUND_FILL } = {}) {
  const bgBuf = await renderApkBackground(size).png().toBuffer();
  const fgBuf = await (await renderApkForeground(input, size, { fill })).png().toBuffer();
  return sharp(bgBuf).composite([{ input: fgBuf }]);
}

/** Slightly larger logo for circular masks (android:roundIcon). */
export function renderApkRound(input, size) {
  return renderApkLegacy(input, size, { fill: APK_ROUND_FILL });
}

/** Flatten adaptive layers — preview / Play Store. */
export async function renderApkFlat(input, size) {
  return renderApkLegacy(input, size);
}

// Back-compat aliases used by older scripts
export const APK_BG = APP_WINDOW_BG;
export const APK_ICON_FILL = APK_FOREGROUND_FILL;
