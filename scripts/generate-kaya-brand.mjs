#!/usr/bin/env node
/**
 * Generate KAYA brand assets (PNG icons, notification glyph, OG image).
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

const COLORS = {
  bg: '#050508',
  surface: '#0c0c12',
  surfaceEdge: '#1a1a24',
  text: '#f0f0f2',
  accent: '#ff3b5c',
  accentSoft: 'rgba(255, 59, 92, 0.35)',
  accentGlow: 'rgba(255, 59, 92, 0.12)',
  purple: 'rgba(100, 60, 255, 0.08)',
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

function drawAmbientGlow(ctx, size) {
  const g = ctx.createRadialGradient(size * 0.5, size * 0.28, 0, size * 0.5, size * 0.28, size * 0.55);
  g.addColorStop(0, 'rgba(255, 59, 92, 0.18)');
  g.addColorStop(0.55, 'rgba(255, 59, 92, 0.04)');
  g.addColorStop(1, 'rgba(255, 59, 92, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const g2 = ctx.createRadialGradient(size * 0.82, size * 0.82, 0, size * 0.82, size * 0.82, size * 0.35);
  g2.addColorStop(0, 'rgba(100, 60, 255, 0.12)');
  g2.addColorStop(1, 'rgba(100, 60, 255, 0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, size, size);
}

function drawMark(ctx, size, { monochrome = false, padding = 0.12 } = {}) {
  const p = size * padding;
  const inner = size - p * 2;
  const r = inner * 0.22;

  if (!monochrome) {
    drawAmbientGlow(ctx, size);
    ctx.save();
    roundedRect(ctx, p, p, inner, inner, r);
    ctx.fillStyle = COLORS.surface;
    ctx.fill();
    ctx.strokeStyle = COLORS.surfaceEdge;
    ctx.lineWidth = Math.max(1, size * 0.006);
    ctx.stroke();
    ctx.restore();
  }

  const text = monochrome ? '#ffffff' : COLORS.text;
  const accent = monochrome ? '#ffffff' : COLORS.accent;
  const stroke = Math.max(2, size * 0.075);
  const cx = size * 0.36;
  const top = size * 0.27;
  const mid = size * 0.5;
  const bottom = size * 0.73;
  const right = size * 0.58;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = text;
  ctx.lineWidth = stroke;

  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, bottom);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, mid);
  ctx.lineTo(right, top);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, mid);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, size * 0.028);
  const waveX = size * 0.66;
  const waves = [
    { rx: size * 0.07, ry: size * 0.11, start: -Math.PI * 0.15, end: Math.PI * 0.55 },
    { rx: size * 0.105, ry: size * 0.155, start: -Math.PI * 0.12, end: Math.PI * 0.52 },
    { rx: size * 0.14, ry: size * 0.2, start: -Math.PI * 0.1, end: Math.PI * 0.48 },
  ];
  for (const w of waves) {
    ctx.beginPath();
    ctx.ellipse(waveX, mid, w.rx, w.ry, 0, w.start, w.end);
    ctx.stroke();
  }

  if (!monochrome) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(size * 0.735, mid, size * 0.028, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function renderPng(size, opts = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, size, size);
  } else {
    ctx.clearRect(0, 0, size, size);
  }
  drawMark(ctx, size, opts);
  return canvas.toBuffer('image/png');
}

async function renderOg() {
  const w = 1200;
  const h = 630;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#050508');
  bg.addColorStop(1, '#12080f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.35, h * 0.45, 0, w * 0.35, h * 0.45, 420);
  glow.addColorStop(0, 'rgba(255, 59, 92, 0.22)');
  glow.addColorStop(1, 'rgba(255, 59, 92, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(190, h / 2 - 120);
  drawMark(ctx, 240, { padding: 0.1 });
  ctx.restore();

  ctx.fillStyle = COLORS.text;
  ctx.font = '600 92px Inter, Arial, sans-serif';
  ctx.fillText('KAYA', 430, h / 2 - 10);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '300 34px Inter, Arial, sans-serif';
  ctx.fillText('Гласов асистент за задачи и календар', 432, h / 2 + 42);

  return canvas.toBuffer('image/png');
}

async function writeSvg() {
  const mark = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="KAYA">
  <defs>
    <radialGradient id="glow" cx="50%" cy="28%" r="55%">
      <stop offset="0%" stop-color="#ff3b5c" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ff3b5c" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#050508"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <rect x="56" y="56" width="400" height="400" rx="88" fill="#0c0c12" stroke="#1a1a24" stroke-width="3"/>
  <g stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M184 138 L184 374" stroke="#f0f0f2" stroke-width="38"/>
    <path d="M184 256 L296 138" stroke="#f0f0f2" stroke-width="38"/>
    <path d="M184 256 L296 374" stroke="#f0f0f2" stroke-width="38"/>
    <path d="M338 206 A72 102 0 0 1 338 306" stroke="#ff3b5c" stroke-width="14"/>
    <path d="M352 188 A108 154 0 0 1 352 324" stroke="#ff3b5c" stroke-width="12" opacity="0.75"/>
    <path d="M366 172 A144 206 0 0 1 366 340" stroke="#ff3b5c" stroke-width="10" opacity="0.5"/>
  </g>
  <circle cx="376" cy="256" r="14" fill="#ff3b5c"/>
</svg>`;

  const full = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" role="img" aria-label="KAYA logo">
  <rect width="640" height="160" fill="none"/>
  <g transform="translate(8,8) scale(0.28)">
    <rect x="56" y="56" width="400" height="400" rx="88" fill="#0c0c12" stroke="#1a1a24" stroke-width="3"/>
    <g stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M184 138 L184 374" stroke="#f0f0f2" stroke-width="38"/>
      <path d="M184 256 L296 138" stroke="#f0f0f2" stroke-width="38"/>
      <path d="M184 256 L296 374" stroke="#f0f0f2" stroke-width="38"/>
      <path d="M338 206 A72 102 0 0 1 338 306" stroke="#ff3b5c" stroke-width="14"/>
      <path d="M352 188 A108 154 0 0 1 352 324" stroke="#ff3b5c" stroke-width="12" opacity="0.75"/>
      <path d="M366 172 A144 206 0 0 1 366 340" stroke="#ff3b5c" stroke-width="10" opacity="0.5"/>
    </g>
    <circle cx="376" cy="256" r="14" fill="#ff3b5c"/>
  </g>
  <text x="150" y="98" fill="#f0f0f2" font-family="Inter, Arial, sans-serif" font-size="56" font-weight="600" letter-spacing="8">KAYA</text>
</svg>`;

  await writeFile(join(OUT, 'logo-mark.svg'), mark);
  await writeFile(join(OUT, 'logo-full.svg'), full);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(ANDROID_OUT, { recursive: true });
  await writeSvg();

  const sizes = [
    ['favicon-32.png', 32, { bg: COLORS.bg, padding: 0.08 }],
    ['icon-192.png', 192, { bg: COLORS.bg }],
    ['icon-512.png', 512, { bg: COLORS.bg }],
    ['apple-touch-icon.png', 180, { bg: COLORS.bg }],
    ['maskable-512.png', 512, { bg: COLORS.bg, padding: 0.06 }],
  ];

  for (const [name, size, opts] of sizes) {
    const buf = await renderPng(size, opts);
    await writeFile(join(OUT, name), buf);
    console.log(`✓ ${name}`);
  }

  const notif = await renderPng(96, { monochrome: true, padding: 0.18, bg: null });
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
