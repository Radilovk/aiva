#!/usr/bin/env node
/**
 * Slim web bundle for Android APK — keeps Package A brand assets, drops web-only bulk.
 *   node scripts/prepare-capacitor-shell.mjs [outDir]
 */
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'capacitor-shell');
const SRC = join(ROOT, 'frontend');

/** Package B not needed in APK — default brand is A */
const EXCLUDE_DIRS = new Set(['pack-b', 'node_modules']);

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
  'favicon-32.webp',
  'icon-192.webp',
  'icon-512.webp',
  'icon-512.png',
  'maskable-512.png',
  'maskable-512.webp',
  'apple-touch-icon.png',
  'apple-touch-icon.webp',
  'listen-120.webp',
  'listen-88.webp',
  'listen-44.webp',
  'brand-mark.webp',
]);

/** Skip duplicate/heavy files inside icons/pack-a — keep logo + listen button */
const PACK_A_SKIP = new Set([
  'og-image.png',
  'og-image.webp',
  'splash-portrait-1080.webp',
  'splash-portrait-720.webp',
  'splash-android.png',
  'icon-512.png',
  'icon-512.webp',
  'maskable-512.png',
  'maskable-512.webp',
  'apple-touch-icon.png',
  'apple-touch-icon.webp',
  'favicon-32.png',
  'favicon-32.webp',
  'logo-mark.png',
  'ic-stat-notification.png',
]);

function shouldSkip(relPath, isDir) {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;

  if (relPath.startsWith('icons/pack-a/') && !isDir) {
    const base = parts[parts.length - 1];
    if (PACK_A_SKIP.has(base)) return true;
    return false;
  }

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

async function patchApkManifest(outDir) {
  const manifestPath = join(outDir, 'manifest.json');
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    manifest.icons = (manifest.icons || []).filter((icon) => {
      const src = String(icon.src || '');
      return src.includes('icon-192') && !src.includes('maskable');
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    /* manifest optional */
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await copyTree(SRC, OUT);
  await patchApkManifest(OUT);
  console.log(`✓ Capacitor shell → ${OUT} (Package A brand assets included)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
