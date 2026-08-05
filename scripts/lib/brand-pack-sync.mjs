/**
 * Copy active brand pack to frontend/icons root (PWA, manifest, splash).
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICONS = join(ROOT, 'frontend', 'icons');
const ANDROID = join(ROOT, 'android-res', 'drawable');

const ROOT_COPY_FILES = [
  'favicon-32.png', 'favicon-32.webp',
  'icon-192.png', 'icon-192.webp',
  'icon-512.png', 'icon-512.webp',
  'apple-touch-icon.png', 'apple-touch-icon.webp',
  'maskable-512.png', 'maskable-512.webp',
  'listen-120.png', 'listen-120.webp',
  'listen-88.png', 'listen-88.webp',
  'listen-44.png', 'listen-44.webp',
  'og-image.png', 'og-image.webp',
  'splash-portrait-1080.webp', 'splash-portrait-720.webp',
  'ic-stat-notification.png',
  'brand-mark.png', 'brand-mark.webp',
  'logo-mark.png',
];

export async function copyPackToRoot(pkg) {
  const p = String(pkg).toUpperCase() === 'B' ? 'B' : 'A';
  const srcDir = join(ICONS, `pack-${p.toLowerCase()}`);
  await mkdir(ICONS, { recursive: true });
  await mkdir(ANDROID, { recursive: true });

  for (const name of ROOT_COPY_FILES) {
    try {
      await copyFile(join(srcDir, name), join(ICONS, name));
    } catch {
      /* optional file */
    }
  }

  try {
    await copyFile(join(srcDir, 'splash-android.png'), join(ANDROID, 'splash.png'));
  } catch { /* ignore */ }

  try {
    await copyFile(join(srcDir, 'ic-stat-notification.png'), join(ANDROID, 'ic_stat_aiva.png'));
  } catch { /* ignore */ }

  await writeFile(join(ROOT, 'brand-assets', 'active-package'), `${p}\n`);
  console.log(`  ✓ Active pack ${p} → frontend/icons/ + android-res/`);
}

export async function readActivePackage() {
  try {
    const raw = await readFile(join(ROOT, 'brand-assets', 'active-package'), 'utf8');
    const p = raw.trim().toUpperCase();
    return p === 'B' ? 'B' : 'A';
  } catch {
    return 'A';
  }
}
