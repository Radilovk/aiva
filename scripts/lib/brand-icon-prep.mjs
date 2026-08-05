/**
 * Launcher / PWA icons from transparent PNG (icon1.png).
 * Adaptive foreground uses ~66% safe zone so OEM masks do not crop the art.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphaBBox } from './kasy-icon-prep.mjs';

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

/** Trim transparent padding (keeps glow, drops empty alpha). */
export async function trimAlphaArt(input, alphaThreshold = 12) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return sharp(input).ensureAlpha().toBuffer();
  return sharp(input).extract({
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }).png().toBuffer();
}

async function fitOnCanvas(input, size, { fill, transparent, bg }) {
  const trimmed = await trimAlphaArt(input);
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

/** Adaptive icon foreground — 66% safe zone (Google / OEM masks). */
export function renderAdaptiveForeground(input, size, { safeFill = 0.66 } = {}) {
  return fitOnCanvas(input, size, { fill: safeFill, transparent: true, bg: '#000000' });
}

/** Legacy / install preview — dark bg, slightly larger but still inside frame. */
export function renderLegacyLauncher(input, size, { fill = 0.78, bg = '#050508' } = {}) {
  return fitOnCanvas(input, size, { fill, transparent: false, bg });
}

/** Web/PWA icon — preserve transparency. */
export async function renderWebIconPng(input, size, { fill = 0.88 } = {}) {
  return fitOnCanvas(input, size, { fill, transparent: true, bg: '#000000' });
}

export async function renderWebIconWebp(input, size, { fill = 0.88, quality = 82 } = {}) {
  return renderWebIconPng(input, size, { fill }).then((p) => p.webp({ quality, effort: 6 }).toBuffer());
}

/** Header logo from JPEG sources (brand.jpg) — unchanged path. */
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
  return fitOnCanvas(input, size, { fill, transparent, bg });
}
