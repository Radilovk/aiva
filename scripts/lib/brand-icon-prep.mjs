/**
 * Build square launcher / brand icon from trimmed art (fit inside, no crop).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 1,
  };
}

export async function trimArt(input, threshold = 18) {
  try {
    return await sharp(input).trim({ threshold }).toBuffer();
  } catch {
    return sharp(input).toBuffer();
  }
}

export async function renderSquareIcon(input, {
  size,
  fill = 0.92,
  transparent = false,
  bg = '#050508',
} = {}) {
  const trimmed = await trimArt(input);
  const inner = Math.round(size * fill);
  const resized = await sharp(trimmed)
    .resize(inner, inner, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const left = Math.floor((size - meta.width) / 2);
  const top = Math.floor((size - meta.height) / 2);
  const background = transparent
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : parseBg(bg);

  return sharp({
    create: { width: size, height: size, channels: 4, background },
  }).composite([{ input: resized, left, top }]);
}
