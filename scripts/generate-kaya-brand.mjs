#!/usr/bin/env node
/**
 * Generate KAYA brand assets — refined voice-assistant visual identity.
 * Run: node scripts/generate-kaya-brand.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCanvas } = require('@napi-rs/canvas');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'frontend', 'icons');
const ANDROID_OUT = join(ROOT, 'android-res', 'drawable');

const C = {
  bg0: '#050508',
  bg1: '#0b0b12',
  card0: '#12121c',
  card1: '#09090f',
  edge: 'rgba(255,255,255,0.08)',
  text: '#f3f3f6',
  accent0: '#ff3b5c',
  accent1: '#ff7a93',
  accent2: '#ff9db0',
  violet: 'rgba(118, 84, 255, 0.14)',
};

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackdrop(ctx, size) {
  const bg = ctx.createRadialGradient(size * 0.5, size * 0.34, 0, size * 0.5, size * 0.5, size * 0.72);
  bg.addColorStop(0, '#14101a');
  bg.addColorStop(0.55, C.bg1);
  bg.addColorStop(1, C.bg0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(size * 0.52, size * 0.46, 0, size * 0.52, size * 0.46, size * 0.34);
  glow.addColorStop(0, 'rgba(255, 59, 92, 0.22)');
  glow.addColorStop(0.55, 'rgba(255, 59, 92, 0.06)');
  glow.addColorStop(1, 'rgba(255, 59, 92, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  const violet = ctx.createRadialGradient(size * 0.82, size * 0.18, 0, size * 0.82, size * 0.18, size * 0.28);
  violet.addColorStop(0, C.violet);
  violet.addColorStop(1, 'rgba(118, 84, 255, 0)');
  ctx.fillStyle = violet;
  ctx.fillRect(0, 0, size, size);
}

function drawCard(ctx, size, padding) {
  const p = size * padding;
  const inner = size - p * 2;
  const r = inner * 0.28;

  ctx.save();
  roundedRect(ctx, p + 2, p + 4, inner, inner, r);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();

  const cardGrad = ctx.createLinearGradient(p, p, p + inner, p + inner);
  cardGrad.addColorStop(0, C.card0);
  cardGrad.addColorStop(1, C.card1);
  roundedRect(ctx, p, p, inner, inner, r);
  ctx.fillStyle = cardGrad;
  ctx.fill();

  const edge = ctx.createLinearGradient(p, p, p, p + inner);
  edge.addColorStop(0, 'rgba(255,255,255,0.14)');
  edge.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  edge.addColorStop(1, 'rgba(255,255,255,0.02)');
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, size * 0.004);
  ctx.stroke();
}

function drawVoiceMark(ctx, size, { monochrome = false, padding = 0.11 } = {}) {
  const p = size * padding;
  const inner = size - p * 2;
  const cx = p + inner * 0.5;
  const cy = p + inner * 0.52;

  if (!monochrome) {
    drawBackdrop(ctx, size);
    drawCard(ctx, size, padding);
  }

  const accent = monochrome ? '#ffffff' : C.accent0;
  const accentSoft = monochrome ? 'rgba(255,255,255,0.55)' : 'rgba(255, 122, 147, 0.55)';
  const accentFaint = monochrome ? 'rgba(255,255,255,0.28)' : 'rgba(255, 157, 176, 0.35)';

  if (!monochrome) {
    for (const [r, alpha] of [[inner * 0.31, 0.16], [inner * 0.24, 0.28], [inner * 0.17, 0.42]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 59, 92, ${alpha})`;
      ctx.lineWidth = Math.max(1, size * 0.004);
      ctx.stroke();
    }
  }

  const barW = inner * 0.055;
  const gap = inner * 0.045;
  const heights = [0.28, 0.46, 0.62, 0.46, 0.28];
  const totalW = heights.length * barW + (heights.length - 1) * gap;
  let x = cx - totalW / 2;

  for (let i = 0; i < heights.length; i += 1) {
    const h = inner * heights[i];
    const y = cy - h / 2;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    if (monochrome) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, 'rgba(255,255,255,0.82)');
    } else {
      grad.addColorStop(0, C.accent2);
      grad.addColorStop(0.45, C.accent1);
      grad.addColorStop(1, C.accent0);
    }
    roundedRect(ctx, x, y, barW, h, barW / 2);
    ctx.fillStyle = grad;
    ctx.fill();
    x += barW + gap;
  }

  if (!monochrome) {
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.045, 0, Math.PI * 2);
    const dot = ctx.createRadialGradient(cx, cy, 0, cx, cy, inner * 0.045);
    dot.addColorStop(0, '#ffffff');
    dot.addColorStop(0.35, C.accent1);
    dot.addColorStop(1, C.accent0);
    ctx.fillStyle = dot;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.04, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  if (!monochrome) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath();
    ctx.ellipse(cx, cy + inner * 0.18, inner * 0.22, inner * 0.04, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 59, 92, 0.12)';
    ctx.fill();
    ctx.restore();
  }
}

async function renderPng(size, opts = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, size, size);
  } else if (!opts.monochrome) {
    ctx.fillStyle = C.bg0;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }
  drawVoiceMark(ctx, size, opts);
  return canvas.toBuffer('image/png');
}

async function renderOg() {
  const w = 1200;
  const h = 630;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#07070d');
  bg.addColorStop(0.55, '#0a0810');
  bg.addColorStop(1, '#120910');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(360, 300, 0, 360, 300, 420);
  glow.addColorStop(0, 'rgba(255, 59, 92, 0.18)');
  glow.addColorStop(1, 'rgba(255, 59, 92, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(250, 90);
  drawVoiceMark(ctx, 450, { padding: 0.1 });
  ctx.restore();

  ctx.fillStyle = C.text;
  ctx.font = '600 88px Inter, Arial, sans-serif';
  ctx.fillText('KAYA', 520, 300);
  ctx.fillStyle = 'rgba(255,255,255,0.58)';
  ctx.font = '300 32px Inter, Arial, sans-serif';
  ctx.fillText('Гласов асистент за задачи и календар', 522, 352);

  return canvas.toBuffer('image/png');
}

async function writeSvg() {
  const mark = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="KAYA">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="72%">
      <stop offset="0%" stop-color="#14101a"/>
      <stop offset="55%" stop-color="#0b0b12"/>
      <stop offset="100%" stop-color="#050508"/>
    </radialGradient>
    <radialGradient id="glow" cx="52%" cy="46%" r="34%">
      <stop offset="0%" stop-color="#ff3b5c" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ff3b5c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#12121c"/>
      <stop offset="100%" stop-color="#09090f"/>
    </linearGradient>
    <linearGradient id="bar" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ff9db0"/>
      <stop offset="45%" stop-color="#ff7a93"/>
      <stop offset="100%" stop-color="#ff3b5c"/>
    </linearGradient>
    <radialGradient id="dot" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#ff7a93"/>
      <stop offset="100%" stop-color="#ff3b5c"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <rect x="56" y="56" width="400" height="400" rx="112" fill="url(#card)" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  <circle cx="256" cy="266" r="126" fill="none" stroke="#ff3b5c" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="256" cy="266" r="98" fill="none" stroke="#ff3b5c" stroke-opacity="0.28" stroke-width="2"/>
  <circle cx="256" cy="266" r="70" fill="none" stroke="#ff3b5c" stroke-opacity="0.42" stroke-width="2"/>
  <rect x="188" y="236" width="18" height="60" rx="9" fill="url(#bar)"/>
  <rect x="214" y="214" width="18" height="104" rx="9" fill="url(#bar)"/>
  <rect x="240" y="198" width="18" height="136" rx="9" fill="url(#bar)"/>
  <rect x="266" y="214" width="18" height="104" rx="9" fill="url(#bar)"/>
  <rect x="292" y="236" width="18" height="60" rx="9" fill="url(#bar)"/>
  <circle cx="256" cy="266" r="18" fill="url(#dot)"/>
</svg>`;

  const full = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" role="img" aria-label="KAYA logo">
  <g transform="translate(8, 8) scale(0.28)">
    <rect x="56" y="56" width="400" height="400" rx="112" fill="#12121c" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
    <rect x="188" y="236" width="18" height="60" rx="9" fill="#ff7a93"/>
    <rect x="214" y="214" width="18" height="104" rx="9" fill="#ff7a93"/>
    <rect x="240" y="198" width="18" height="136" rx="9" fill="#ff3b5c"/>
    <rect x="266" y="214" width="18" height="104" rx="9" fill="#ff7a93"/>
    <rect x="292" y="236" width="18" height="60" rx="9" fill="#ff7a93"/>
    <circle cx="256" cy="266" r="18" fill="#ff3b5c"/>
  </g>
  <text x="148" y="98" fill="#f3f3f6" font-family="Inter, Arial, sans-serif" font-size="56" font-weight="600" letter-spacing="10">KAYA</text>
</svg>`;

  await writeFile(join(OUT, 'logo-mark.svg'), mark);
  await writeFile(join(OUT, 'logo-full.svg'), full);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(ANDROID_OUT, { recursive: true });
  await writeSvg();

  const sizes = [
    ['favicon-32.png', 32, { bg: C.bg0, padding: 0.06 }],
    ['icon-192.png', 192, { bg: C.bg0 }],
    ['icon-512.png', 512, { bg: C.bg0 }],
    ['apple-touch-icon.png', 180, { bg: C.bg0 }],
    ['maskable-512.png', 512, { bg: C.bg0, padding: 0.08 }],
  ];

  for (const [name, size, opts] of sizes) {
    await writeFile(join(OUT, name), await renderPng(size, opts));
    console.log(`✓ ${name}`);
  }

  const notif = await renderPng(96, { monochrome: true, padding: 0.14, bg: null });
  await writeFile(join(OUT, 'ic-stat-notification.png'), notif);
  await writeFile(join(ANDROID_OUT, 'ic_stat_aiva.png'), notif);
  console.log('✓ ic-stat-notification.png + android-res/drawable/ic_stat_aiva.png');

  await writeFile(join(OUT, 'og-image.png'), await renderOg());
  console.log('✓ og-image.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
