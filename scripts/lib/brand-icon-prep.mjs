/**
 * Single canonical app icon from icon1.png — same output for PWA and APK.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

/** One fill ratio everywhere — matches the PWA icon the user approved. */
export const APP_ICON_FILL = 0.88;

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1,
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

/** Canonical app icon — transparent PNG, used by PWA and APK from the same source. */
export function renderAppIcon(input, size, { fill = APP_ICON_FILL } = {}) {
  return fitOnCanvas(input, size, { fill, transparent: true, bg: '#00000000' });
}

/** @deprecated Use renderAppIcon — kept for header logos from JPEG. */
export function renderAdaptiveForeground(input, size, { safeFill = APP_ICON_FILL } = {}) {
  return renderAppIcon(input, size, { fill: safeFill });
}

/** @deprecated Use renderAppIcon — no opaque legacy box. */
export function renderLegacyLauncher(input, size, { fill = APP_ICON_FILL } = {}) {
  return renderAppIcon(input, size, { fill });
}

export function renderWebIconPng(input, size, { fill = APP_ICON_FILL } = {}) {
  return renderAppIcon(input, size, { fill });
}

export async function renderWebIconWebp(input, size, { fill = APP_ICON_FILL, quality = 82 } = {}) {
  return renderAppIcon(input, size, { fill }).then((p) => p.webp({ quality, effort: 6 }).toBuffer());
}

/** Header logo from JPEG sources (brand.jpg). */
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
