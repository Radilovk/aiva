#!/usr/bin/env node
/**
 * Package A — generated KASY brand assets (voice + calendar grid + speech bubble).
 * Uses sharp (no canvas dependency). Run via: node scripts/apply-brand-package.mjs A
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const OUT = join(ROOT, 'frontend', 'icons', 'pack-a');
const ICONS_ROOT = join(ROOT, 'frontend', 'icons');
const ANDROID_OUT = join(ROOT, 'android-res', 'drawable');
const PACKAGE_OUT = join(ROOT, 'brand-assets', 'package-a');

const C = {
  bg0: '#050508',
  bg1: '#0b0b12',
  card0: '#12121c',
  card1: '#09090f',
  text: '#f3f3f6',
  accent0: '#ff3b5c',
  accent1: '#ff7a93',
  accent2: '#ff9db0',
  success: '#2dd4a8',
};

/** Voice waveform bars (center of icon) */
function voiceBars(cx, cy, inner, scale = 1) {
  const barW = inner * 0.055 * scale;
  const gap = inner * 0.045 * scale;
  const heights = [0.28, 0.46, 0.62, 0.46, 0.28];
  const totalW = heights.length * barW + (heights.length - 1) * gap;
  let x = cx - totalW / 2;
  let bars = '';
  for (const h of heights) {
    const bh = inner * h * scale;
    const y = cy - bh / 2;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="${(barW / 2).toFixed(1)}" fill="url(#bar)"/>`;
    x += barW + gap;
  }
  return bars + `<circle cx="${cx}" cy="${cy}" r="${(inner * 0.045 * scale).toFixed(1)}" fill="url(#dot)"/>`;
}

/** Mini calendar with task dots */
function calendarBadge(x, y, w, h) {
  const headerH = h * 0.22;
  const cols = 4;
  const rows = 3;
  const cellW = (w - 8) / cols;
  const cellH = (h - headerH - 8) / rows;
  const taskColors = [C.success, C.accent1, C.accent0, C.success, C.accent1, C.accent0];
  let dots = '';
  let i = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (Math.random() > 0.45) {
        const dx = x + 4 + c * cellW + cellW * 0.35;
        const dy = y + headerH + 4 + r * cellH + cellH * 0.3;
        dots += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${(w * 0.04).toFixed(1)}" fill="${taskColors[i % taskColors.length]}" opacity="0.9"/>`;
        i += 1;
      }
    }
  }
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(w * 0.12).toFixed(1)}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="${headerH}" rx="${(w * 0.12).toFixed(1)}" fill="rgba(255,59,92,0.25)"/>
      <rect x="${x}" y="${y + headerH - 2}" width="${w}" height="2" fill="rgba(255,59,92,0.15)"/>
      ${dots}
    </g>`;
}

/** Speech bubble with typing dots */
function speechBubble(x, y, w, h) {
  const tail = `M${x + w * 0.2} ${y + h} L${x + w * 0.12} ${y + h + h * 0.35} L${x + w * 0.38} ${y + h}`;
  const dotR = h * 0.09;
  const cy = y + h * 0.48;
  const d1 = x + w * 0.28;
  const d2 = x + w * 0.5;
  const d3 = x + w * 0.72;
  return `
    <g>
      <path d="M ${x + w * 0.15} ${y} H ${x + w * 0.85} Q ${x + w} ${y} ${x + w} ${y + h * 0.2} V ${y + h * 0.75} Q ${x + w} ${y + h} ${x + w * 0.85} ${y + h} ${tail} Z" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
      <circle cx="${d1}" cy="${cy}" r="${dotR}" fill="${C.accent2}" opacity="0.85"/>
      <circle cx="${d2}" cy="${cy}" r="${dotR}" fill="${C.accent1}" opacity="0.7"/>
      <circle cx="${d3}" cy="${cy}" r="${dotR}" fill="${C.accent0}" opacity="0.55"/>
    </g>`;
}

function iconSvg(size, { padding = 0.11, extras = true } = {}) {
  const p = size * padding;
  const inner = size - p * 2;
  const cx = p + inner * 0.5;
  const cy = p + inner * 0.52;
  const r = inner * 0.28;
  const calW = inner * 0.36;
  const calH = inner * 0.3;
  const calX = p + inner * 0.56;
  const calY = p + inner * 0.58;
  const bubW = inner * 0.4;
  const bubH = inner * 0.22;
  const bubX = p + inner * 0.06;
  const bubY = p + inner * 0.08;

  const extrasSvg = extras
    ? calendarBadge(calX, calY, calW, calH) + speechBubble(bubX, bubY, bubW, bubH)
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="72%">
      <stop offset="0%" stop-color="#14101a"/>
      <stop offset="55%" stop-color="${C.bg1}"/>
      <stop offset="100%" stop-color="${C.bg0}"/>
    </radialGradient>
    <radialGradient id="glow" cx="52%" cy="46%" r="34%">
      <stop offset="0%" stop-color="${C.accent0}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${C.accent0}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${C.card0}"/>
      <stop offset="100%" stop-color="${C.card1}"/>
    </linearGradient>
    <linearGradient id="bar" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${C.accent2}"/>
      <stop offset="45%" stop-color="${C.accent1}"/>
      <stop offset="100%" stop-color="${C.accent0}"/>
    </linearGradient>
    <radialGradient id="dot" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="${C.accent1}"/>
      <stop offset="100%" stop-color="${C.accent0}"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" fill="url(#glow)"/>
  <rect x="${p}" y="${p}" width="${inner}" height="${inner}" rx="${(inner * 0.28).toFixed(1)}" fill="url(#card)" stroke="rgba(255,255,255,0.08)" stroke-width="${Math.max(1, size * 0.004).toFixed(2)}"/>
  <circle cx="${cx}" cy="${cy}" r="${(inner * 0.31).toFixed(1)}" fill="none" stroke="${C.accent0}" stroke-opacity="0.16" stroke-width="${Math.max(1, size * 0.004).toFixed(2)}"/>
  <circle cx="${cx}" cy="${cy}" r="${(inner * 0.24).toFixed(1)}" fill="none" stroke="${C.accent0}" stroke-opacity="0.28" stroke-width="${Math.max(1, size * 0.004).toFixed(2)}"/>
  ${voiceBars(cx, cy, inner)}
  ${extrasSvg}
</svg>`;
}

function splashSvg(w, h) {
  const cx = w * 0.5;
  const orbR = w * 0.22;
  const orbY = h * 0.38;
  const calW = w * 0.78;
  const calH = h * 0.22;
  const calX = (w - calW) / 2;
  const calY = h * 0.58;

  const taskRows = [0.25, 0.42, 0.58, 0.75].map((pct, i) => {
    const y = calY + calH * 0.28 + (calH * 0.62) * (i / 3.5);
    const barW = calW * (0.35 + (i % 3) * 0.12);
    const color = i % 2 === 0 ? C.accent0 : C.success;
    return `<rect x="${(calX + calW * 0.08).toFixed(0)}" y="${y.toFixed(0)}" width="${barW.toFixed(0)}" height="${(calH * 0.06).toFixed(0)}" rx="4" fill="${color}" opacity="0.75"/>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="splashGlow" cx="50%" cy="35%" r="55%">
      <stop offset="0%" stop-color="${C.accent0}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${C.bg0}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bar" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${C.accent2}"/>
      <stop offset="100%" stop-color="${C.accent0}"/>
    </linearGradient>
    <radialGradient id="dot" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="${C.accent0}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${C.bg0}"/>
  <rect width="${w}" height="${h}" fill="url(#splashGlow)"/>
  <text x="${cx}" y="${h * 0.12}" text-anchor="middle" fill="${C.text}" font-family="Inter,Arial,sans-serif" font-size="${w * 0.09}" font-weight="600" letter-spacing="12">KASY</text>
  <text x="${cx}" y="${h * 0.155}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-family="Inter,Arial,sans-serif" font-size="${w * 0.035}" font-weight="300">AI Secretary</text>
  ${speechBubble(w * 0.08, h * 0.2, w * 0.42, h * 0.055)}
  <circle cx="${cx}" cy="${orbY}" r="${(orbR * 1.15).toFixed(0)}" fill="none" stroke="${C.accent0}" stroke-opacity="0.15" stroke-width="2"/>
  <circle cx="${cx}" cy="${orbY}" r="${orbR.toFixed(0)}" fill="rgba(255,59,92,0.12)" stroke="${C.accent0}" stroke-opacity="0.35" stroke-width="2"/>
  ${voiceBars(cx, orbY, orbR * 1.6, 0.85)}
  <rect x="${calX}" y="${calY}" width="${calW}" height="${calH}" rx="20" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
  <rect x="${calX}" y="${calY}" width="${calW}" height="${calH * 0.18}" rx="20" fill="rgba(255,59,92,0.2)"/>
  <text x="${calX + calW * 0.06}" y="${calY + calH * 0.13}" fill="rgba(255,255,255,0.7)" font-family="Inter,Arial,sans-serif" font-size="${w * 0.032}" font-weight="500">Today's schedule</text>
  ${taskRows}
</svg>`;
}

function ogSvg() {
  return splashSvg(1200, 630).replace('viewBox="0 0 1200 630"', 'viewBox="0 0 1200 630"');
}

async function renderSvg(svg, width, height) {
  return sharp(Buffer.from(svg)).resize(width, height).png({ compressionLevel: 9 }).toBuffer();
}

async function writePngWebp(pngBuf, baseName) {
  const pngPath = join(OUT, `${baseName}.png`);
  const webpPath = join(OUT, `${baseName}.webp`);
  await writeFile(pngPath, pngBuf);
  const webp = await sharp(pngBuf).webp({ quality: 82, effort: 6 }).toBuffer();
  await writeFile(webpPath, webp);
  await writeFile(join(PACKAGE_OUT, `${baseName}.png`), pngBuf);
}

async function writeSvgFiles() {
  const mark = iconSvg(512, { extras: true });
  for (const dir of [OUT, PACKAGE_OUT]) {
    await writeFile(join(dir, 'logo-mark.svg'), mark);
    await writeFile(join(dir, 'brand-mark.svg'), mark);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(ANDROID_OUT, { recursive: true });
  await mkdir(PACKAGE_OUT, { recursive: true });
  await writeSvgFiles();

  console.log('Package A — icons (voice + calendar + speech bubble):');
  const iconSizes = [
    ['favicon-32', 32, { padding: 0.06 }],
    ['icon-192', 192, {}],
    ['icon-512', 512, {}],
    ['apple-touch-icon', 180, {}],
    ['maskable-512', 512, { padding: 0.08 }],
  ];
  for (const [name, size, opts] of iconSizes) {
    const buf = await renderSvg(iconSvg(size, { ...opts, extras: true }), size, size);
    await writePngWebp(buf, name);
    console.log(`  ✓ ${name}.png`);
  }

  const notifSvg = iconSvg(96, { padding: 0.14, extras: false });
  const notifBuf = await sharp(Buffer.from(notifSvg)).resize(96, 96).png().toBuffer();
  await writeFile(join(OUT, 'ic-stat-notification.png'), notifBuf);
  await writeFile(join(ANDROID_OUT, 'ic_stat_aiva.png'), notifBuf);
  console.log('  ✓ ic-stat-notification.png');

  console.log('Package A — splash (calendar schedule + speech bubble):');
  for (const [name, w, h] of [['splash-portrait-1080', 1080, 1920], ['splash-portrait-720', 720, 1280]]) {
    const buf = await renderSvg(splashSvg(w, h), w, h);
    const webp = await sharp(buf).webp({ quality: 78, effort: 6 }).toBuffer();
    await writeFile(join(OUT, `${name}.webp`), webp);
    await writeFile(join(PACKAGE_OUT, `${name}.webp`), webp);
    console.log(`  ✓ ${name}.webp`);
  }

  const androidSplash = await renderSvg(splashSvg(720, 1280), 720, 1280);
  await writeFile(join(ANDROID_OUT, 'splash.png'), androidSplash);
  console.log('  ✓ android-res/drawable/splash.png');

  const ogBuf = await renderSvg(ogSvg(), 1200, 630);
  await writePngWebp(ogBuf, 'og-image');
  console.log('  ✓ og-image.png');

  const listenBuf = await renderSvg(iconSvg(240, { padding: 0.05, extras: false }), 240, 240);
  for (const s of [120, 88, 44]) {
    const resized = await sharp(listenBuf).resize(s * 2, s * 2).png().toBuffer();
    await writePngWebp(resized, `listen-${s}`);
    console.log(`  ✓ listen-${s}`);
  }

  console.log('Done — package A assets in frontend/icons/pack-a/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
