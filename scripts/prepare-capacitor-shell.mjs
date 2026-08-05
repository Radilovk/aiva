#!/usr/bin/env node
/**
 * Slim web bundle for Android APK — excludes brand archives and web-only assets.
 *   node scripts/prepare-capacitor-shell.mjs [outDir]
 */
import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'capacitor-shell');
const SRC = join(ROOT, 'frontend');

const EXCLUDE_DIRS = new Set(['pack-a', 'pack-b', 'node_modules']);
const EXCLUDE_FILES = new Set([
  'admin.html',
  'admin.js',
  'landing.html',
  'landing.css',
  'landing.js',
  'i18n-landing.js',
  'og-image.png',
  'og-image.webp',
  'splash-portrait-1080.webp',
  'splash-portrait-720.webp',
  'listen-120.png',
  'listen-88.png',
  'listen-44.png',
  'brand-mark.png',
  'logo-mark.png',
  'favicon-32.webp',
  'icon-192.webp',
  'icon-512.webp',
  'apple-touch-icon.webp',
  'maskable-512.webp',
  'listen-120.webp',
  'listen-88.webp',
  'listen-44.webp',
  'brand-mark.webp',
]);

function shouldSkip(relPath, isDir) {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (!isDir && EXCLUDE_FILES.has(base)) return true;
  if (!isDir && base.endsWith('.md')) return true;
  return false;
}

async function copyTree(srcDir, destDir, rel = '') {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (shouldSkip(entryRel, entry.isDirectory())) continue;
    const from = join(srcDir, entry.name);
    const to = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, entryRel);
    } else {
      await cp(from, to);
    }
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await copyTree(SRC, OUT);
  console.log(`✓ Capacitor shell → ${OUT} (slim APK bundle)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
