/**
 * Android launcher icons — flat PWA look on #050508, padded for adaptive masks.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APK_BG = '#050508';
/** Slightly inset so squircle/circle masks do not clip headset edges. */
export const APK_ICON_FILL = 0.86;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

/** One flat launcher bitmap — same for adaptive foreground and legacy. */
export function renderApkIcon(input, size, { fill = APK_ICON_FILL } = {}) {
  const inner = Math.round(size * fill);
  const resized = sharp(input)
    .resize(inner, inner, { fit: 'inside', background: TRANSPARENT })
    .png()
    .toBuffer();

  return resized.then(async (buf) => {
    const meta = await sharp(buf).metadata();
    const left = Math.floor((size - meta.width) / 2);
    const top = Math.floor((size - meta.height) / 2);
    return sharp({
      create: { width: size, height: size, channels: 4, background: parseBg(APK_BG) },
    }).composite([{ input: buf, left, top }]);
  });
}

export function renderApkForeground(input, size) {
  return renderApkIcon(input, size);
}

export function renderApkLegacy(input, size) {
  return renderApkIcon(input, size);
}
