/**
 * Android adaptive launcher from PSX icons.
 * - Foreground: art scaled into 66% safe zone (no mask crop), transparent PNG
 * - Background: #050508 (transparent → white on install screen)
 * - Legacy ic_launcher: flattened fg on dark bg for install preview
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

/** Google adaptive icon safe zone = 66/108 of viewport */
export const APK_SAFE_ZONE = 0.66;
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

async function fitInSafeZone(input, size, { background }) {
  const inner = Math.round(size * APK_SAFE_ZONE);
  const resized = await sharp(input)
    .resize(inner, inner, { fit: 'inside', background: TRANSPARENT })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.floor((size - meta.width) / 2);
  const top = Math.floor((size - meta.height) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  }).composite([{ input: resized, left, top }]);
}

/** Adaptive foreground — transparent, art inside safe zone (not clipped by mask). */
export function renderApkForeground(input, size) {
  return fitInSafeZone(input, size, { background: TRANSPARENT });
}

/** Legacy / install preview — dark app bg, same safe-zone scale. */
export function renderApkLegacy(input, size) {
  return fitInSafeZone(input, size, { background: parseBg(APK_BG) });
}
