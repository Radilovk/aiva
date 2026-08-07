#!/usr/bin/env node
/**
 * Simulate launcher masks on adaptive icon (circle, squircle, teardrop) + NutriPlan compare.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  APK_ICON_BG,
  renderAdaptiveForeground,
  resolveLauncherTile,
} from './lib/android-icon.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, '.artifacts', 'launcher-sim');

const SIZE = 192;

function parseBg(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    alpha: 255,
  };
}

function maskSvg(name, size) {
  if (name === 'circle') {
    return Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`);
  }
  if (name === 'squircle') {
    const r = size * 0.22;
    return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/></svg>`);
  }
  // MIUI-style teardrop (approximate)
  const w = size;
  const h = size;
  return Buffer.from(
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path fill="white" d="M ${w*0.5} ${h*0.02} C ${w*0.88} ${h*0.05} ${w*0.98} ${h*0.42} ${w*0.92} ${h*0.72}
        C ${w*0.86} ${h*0.95} ${w*0.5} ${h*0.98} ${w*0.5} ${h*0.98}
        C ${w*0.5} ${h*0.98} ${w*0.14} ${h*0.95} ${w*0.08} ${h*0.72}
        C ${w*0.02} ${h*0.42} ${w*0.12} ${h*0.05} ${w*0.5} ${h*0.02} Z"/>
    </svg>`,
  );
}

async function compositeLauncher(fgBuf, size, maskName) {
  const bg = parseBg(APK_ICON_BG);
  const bgBuf = await sharp({
    create: { width: size, height: size, channels: 3, background: bg },
  }).png().toBuffer();
  const flat = await sharp(bgBuf)
    .composite([{ input: fgBuf, gravity: 'center' }])
    .png()
    .toBuffer();
  const mask = await sharp(maskSvg(maskName, size)).resize(size, size).png().toBuffer();
  return sharp(flat).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function opaqueFill(buf, size) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = 0, maxY = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const aw = maxX - minX + 1;
  const ah = maxY - minY + 1;
  return { aw, ah, fillW: aw / size, fillH: ah / size };
}

async function simLabel(tilePath, label) {
  const scale = SIZE / 432;
  const fgFull = await (await renderAdaptiveForeground(tilePath, 432)).png().toBuffer();
  const fg = await sharp(fgFull).resize(Math.round(432 * scale), Math.round(432 * scale)).png().toBuffer();
  for (const mask of ['circle', 'squircle', 'teardrop']) {
    const out = await compositeLauncher(fg, SIZE, mask);
    const fill = await opaqueFill(out, SIZE);
    await writeFile(join(OUT, `${label}-${mask}.png`), out);
    console.log(`  ${label} ${mask}: art fill ${(fill.fillW * 100).toFixed(0)}% × ${(fill.fillH * 100).toFixed(0)}%`);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const kasyTile = await resolveLauncherTile();
  console.log('Launcher simulation →', OUT);
  console.log('KASY tile:', kasyTile);
  await simLabel(kasyTile, 'kasy');

  const nutri = '/tmp/aidiet/icon-512x512.png';
  try {
    await readFile(nutri);
    await simLabel(nutri, 'nutriplan');
  } catch {
    console.log('  (NutriPlan reference not found — skip)');
  }
  console.log('Done. Open .artifacts/launcher-sim/ to compare visually.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
