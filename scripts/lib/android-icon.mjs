/**
 * Android adaptive icons — transparent foreground on #050508 background layer.
 * Strips baked-in black padding from flattened exports so the robot fills the mask.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAppIcon, renderSquareIcon, APP_ICON_FILL } from './brand-icon-prep.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));

export const APK_BG = '#050508';
export const APK_ICON_FILL = APP_ICON_FILL;

/** Remove solid black letterboxing from flattened icon exports. */
export async function prepApkIconSource(input) {
  try {
    return await sharp(input).trim({ threshold: 28 }).ensureAlpha().png().toBuffer();
  } catch {
    return sharp(input).ensureAlpha().png().toBuffer();
  }
}

/** Adaptive foreground: transparent corners; background layer provides #050508. */
export async function renderApkForeground(input, size) {
  const prepped = await prepApkIconSource(input);
  return renderAppIcon(prepped, size, { fill: APK_ICON_FILL });
}

/** Pre-API-26 / fallback launcher tiles: full opaque square. */
export async function renderApkLegacy(input, size) {
  const prepped = await prepApkIconSource(input);
  return renderSquareIcon(prepped, { size, fill: APK_ICON_FILL, transparent: false, bg: APK_BG });
}
