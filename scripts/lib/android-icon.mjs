/**
 * Android launcher icons — same fit as PWA (contain on square, alpha preserved).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APK_BG = '#050508';
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

async function fitIconOnSquare(input, size, { background }) {
  const resized = await sharp(input)
    .resize(size, size, { fit: 'inside', background: TRANSPARENT })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.floor((size - meta.width) / 2);
  const top = Math.floor((size - meta.height) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  }).composite([{ input: resized, left, top }]);
}

/** Adaptive foreground — transparent PNG, same scale as PWA icon. */
export function renderApkForeground(input, size) {
  return fitIconOnSquare(input, size, { background: TRANSPARENT });
}

/** Legacy launcher — icon on app background (install preview / API < 26). */
export function renderApkLegacy(input, size) {
  return fitIconOnSquare(input, size, { background: parseBg(APK_BG) });
}
