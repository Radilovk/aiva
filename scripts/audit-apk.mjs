#!/usr/bin/env node
/**
 * Audit built APK: correct icons, launch theme, splash image, no Capacitor defaults.
 * Usage: node scripts/audit-apk.mjs [path/to/app-release.apk]
 */
import { readFile, mkdir, rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require(join(ROOT, 'workers/node_modules/sharp'));
const APK = process.argv[2] || join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const OUT = join(ROOT, '.artifacts', 'apk-audit');
const APKTOOL = '/tmp/apktool.jar';

/** Capacitor default xxxhdpi foreground — must NOT appear in release APK */
const CAPACITOR_DEFAULT_FG_MD5 = 'ed3696b7c52d9747411a475dbe3fa34a';

function md5(buf) {
  return createHash('md5').update(buf).digest('hex');
}

async function ensureApktool() {
  try {
    await access(APKTOOL);
  } catch {
    execSync(
      'curl -fsSL https://github.com/iBotPeaches/Apktool/releases/download/v2.9.3/apktool_2.9.3.jar -o /tmp/apktool.jar',
      { stdio: 'inherit' },
    );
  }
}

async function main() {
  await ensureApktool();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  execSync(`java -jar ${APKTOOL} d -f "${APK}" -o "${OUT}/decoded"`, { stdio: 'pipe' });

  const fgApk = await readFile(join(OUT, 'decoded', 'res', 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'));
  const fgApkMd5 = md5(fgApk);
  const fgMeta = await sharp(fgApk).metadata();
  const styles = await readFile(join(OUT, 'decoded', 'res', 'values', 'styles.xml'), 'utf8');
  const manifest = await readFile(join(OUT, 'decoded', 'AndroidManifest.xml'), 'utf8');
  const colors = await readFile(join(OUT, 'decoded', 'res', 'values', 'colors.xml'), 'utf8');

  const checks = [
    ['not Capacitor default icon', fgApkMd5 !== CAPACITOR_DEFAULT_FG_MD5, fgApkMd5],
    ['launcher fg is 192×192', fgMeta.width === 192 && fgMeta.height === 192, `${fgMeta.width}×${fgMeta.height}`],
    ['windowBackground=@drawable/splash', /android:windowBackground">@drawable\/splash/.test(styles)],
    ['splash_image.png in APK', await readFile(join(OUT, 'decoded', 'res', 'drawable', 'splash_image.png')).then((b) => b.length > 10000).catch(() => false)],
    ['no Capacitor vector fg', !(await readFile(join(OUT, 'decoded', 'res', 'drawable-v24', 'ic_launcher_foreground.xml'), 'utf8').catch(() => null))],
    ['themed icon disabled', /THEMED_ICON_ENABLED.*false/.test(manifest)],
    ['ic_launcher_background #050508', colors.includes('#ff050508') || colors.includes('#050508')],
  ];

  console.log(`APK audit: ${APK}\n`);
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
    if (!ok) failed += 1;
  }

  if (failed > 0) throw new Error(`${failed} audit check(s) failed`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
