/**
 * Android adaptive icons — maskable-style: robot in 66% safe zone on #050508.
 * Corners are filled with bg so launcher masks never clip the art.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APK_BG = '#050508';
/** Google adaptive icon safe zone = 66dp / 108dp */
export const APK_ICON_FILL = 66 / 108;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

async function renderMaskableSquare(input, size) {
  const inner = Math.max(1, Math.round(size * APK_ICON_FILL));
  const resized = await sharp(input)
    .resize(inner, inner, { fit: 'inside', background: TRANSPARENT })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.floor((size - meta.width) / 2);
  const top = Math.floor((size - meta.height) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: parseBg(APK_BG) },
  }).composite([{ input: resized, left, top }]);
}

/** Foreground + legacy: opaque maskable tile (bg corners + centered art). */
export function renderApkForeground(input, size) {
  return renderMaskableSquare(input, size);
}

export function renderApkLegacy(input, size) {
  return renderMaskableSquare(input, size);
}
