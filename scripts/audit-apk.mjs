#!/usr/bin/env node
/**
 * Audit built APK: maskable adaptive icons, launch theme, no splash, no Capacitor defaults.
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

async function cornerAlpha(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  return [
    data[3],
    data[(w - 1) * 4 + 3],
    data[(h - 1) * w * 4 + 3],
    data[(h * w - 1) * 4 + 3],
  ];
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

  const resRoot = join(OUT, 'decoded', 'res');
  const fgApk = await readFile(join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'));
  const legacyApk = await readFile(join(resRoot, 'mipmap-xxxhdpi', 'ic_launcher.png'));
  const fgApkMd5 = md5(fgApk);
  const fgMeta = await sharp(fgApk).metadata();
  const legacyCorners = await cornerAlpha(legacyApk);
  const styles = await readFile(join(resRoot, 'values', 'styles.xml'), 'utf8');
  const manifest = await readFile(join(OUT, 'decoded', 'AndroidManifest.xml'), 'utf8');
  const colors = await readFile(join(resRoot, 'values', 'colors.xml'), 'utf8');
  const adaptiveXml = await readFile(join(resRoot, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8').catch(() => '');

  const checks = [
    ['not Capacitor default icon', fgApkMd5 !== CAPACITOR_DEFAULT_FG_MD5, fgApkMd5],
    ['launcher fg is 432×432', fgMeta.width === 432 && fgMeta.height === 432, `${fgMeta.width}×${fgMeta.height}`],
    ['adaptive icon XML present', adaptiveXml.includes('<adaptive-icon')],
    ['adaptive background uses @color', adaptiveXml.includes('@color/ic_launcher_background')],
    ['legacy launcher corners transparent', legacyCorners.every((a) => a < 20), legacyCorners.join(',')],
    ['windowBackground=@color/app_background', /android:windowBackground">@color\/app_background/.test(styles)],
    ['no splash drawable in APK', !(await readFile(join(resRoot, 'drawable', 'splash.xml'), 'utf8').catch(() => null))],
    ['no Capacitor vector fg', !(await readFile(join(resRoot, 'drawable-v24', 'ic_launcher_foreground.xml'), 'utf8').catch(() => null))],
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
