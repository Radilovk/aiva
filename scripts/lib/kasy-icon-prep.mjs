/**
 * Prepare KASY icon art for launcher / PWA (trim alpha halo, square, scale).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

/** Opaque pixel bounding box (alpha > threshold). */
export async function alphaBBox(input, threshold = 40) {
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
      if (data[i + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** Crop to opaque content, pad to square, return sharp pipeline. */
export async function cropToSquareArt(input, { padRatio = 0.06 } = {}) {
  const bbox = await alphaBBox(input);
  if (!bbox) return sharp(input).ensureAlpha();

  const side = Math.max(bbox.width, bbox.height);
  const pad = Math.round(side * padRatio);
  const canvas = side + pad * 2;
  const left = bbox.left - Math.floor((side - bbox.width) / 2) - pad;
  const top = bbox.top - Math.floor((side - bbox.height) / 2) - pad;

  const src = await sharp(input).ensureAlpha().toBuffer();
  const meta = await sharp(src).metadata();

  const extractLeft = Math.max(0, left);
  const extractTop = Math.max(0, top);
  const extractRight = Math.min(meta.width, left + canvas);
  const extractBottom = Math.min(meta.height, top + canvas);
  const extractW = extractRight - extractLeft;
  const extractH = extractBottom - extractTop;

  let pipeline = sharp(src).extract({
    left: extractLeft,
    top: extractTop,
    width: extractW,
    height: extractH,
  });

  const padLeft = Math.max(0, -left);
  const padTop = Math.max(0, -top);
  const padRight = Math.max(0, left + canvas - meta.width);
  const padBottom = Math.max(0, top + canvas - meta.height);

  if (padLeft || padTop || padRight || padBottom) {
    pipeline = pipeline.extend({
      left: padLeft,
      top: padTop,
      right: padRight,
      bottom: padBottom,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  return pipeline.resize(canvas, canvas, { fit: 'cover' });
}

/**
 * Fit art into square output.
 * @param {object} opts
 * @param {number} opts.size - output px
 * @param {number} opts.fill - fraction of canvas used by art (0.72–0.88)
 * @param {boolean} opts.transparent - true for adaptive foreground
 * @param {string} opts.bg - hex for opaque background
 */
export async function renderIconSquare(input, { size, fill = 0.84, transparent = false, bg = '#050508' } = {}) {
  const art = await cropToSquareArt(input);
  const inner = Math.round(size * fill);
  const offset = Math.floor((size - inner) / 2);

  const resized = await art
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const bgColor = transparent
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : {
        r: parseInt(bg.slice(1, 3), 16),
        g: parseInt(bg.slice(3, 5), 16),
        b: parseInt(bg.slice(5, 7), 16),
        alpha: 1,
      };

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bgColor,
    },
  })
    .composite([{ input: resized, left: offset, top: offset }])
    .png({ compressionLevel: 9 });
}

/** Maskable PWA icon — 80% safe zone on brand background. */
export async function renderMaskable(input, size, bg = '#050508') {
  return renderIconSquare(input, { size, fill: 0.62, transparent: false, bg });
}
