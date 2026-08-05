#!/usr/bin/env node
/**
 * Slim APK web bundle — brand.webp + button.webp only.
 */
import { cp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || join(ROOT, 'capacitor-shell');
const SRC = join(ROOT, 'frontend');

const EXCLUDE_DIRS = new Set(['node_modules']);

const KEEP_ICONS = new Set([
  'brand.css',
  'brand.webp',
  'button.webp',
  'icon-512.png',
  'icon-512.webp',
  'icon-192.png',
  'favicon-32.webp',
  'ic-stat-notification.png',
  'logo-full.svg',
]);

const EXCLUDE_FILES = new Set([
  'admin.html',
  'admin.js',
  'landing.html',
  'landing.css',
  'landing.js',
  'i18n-landing.js',
]);

function shouldSkip(relPath, isDir) {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (relPath.startsWith('icons/') && !isDir) {
    return !KEEP_ICONS.has(parts[parts.length - 1]);
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
    manifest.icons = [
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any' },
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    ];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    /* optional */
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await copyTree(SRC, OUT);
  await patchApkManifest(OUT);
  console.log(`✓ Capacitor shell → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
