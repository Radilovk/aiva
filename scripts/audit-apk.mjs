#!/usr/bin/env node
/**
 * Audit built APK: correct icons, launch theme, no splash, no Capacitor defaults.
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

  const iconApk = await readFile(join(OUT, 'decoded', 'res', 'mipmap-xxxhdpi', 'ic_launcher.png'));
  const iconApkMd5 = md5(iconApk);
  const { data: iconRaw, info: iconInfo } = await sharp(iconApk)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => iconRaw[(y * iconInfo.width + x) * 4 + 3];
  const last = iconInfo.width - 1;
  const styles = await readFile(join(OUT, 'decoded', 'res', 'values', 'styles.xml'), 'utf8');
  const manifest = await readFile(join(OUT, 'decoded', 'AndroidManifest.xml'), 'utf8');

  const checks = [
    ['not Capacitor default icon', iconApkMd5 !== CAPACITOR_DEFAULT_FG_MD5, iconApkMd5],
    ['launcher icon is 192×192', iconInfo.width === 192 && iconInfo.height === 192, `${iconInfo.width}×${iconInfo.height}`],
    ['launcher icon is round (transparent corners)',
      alphaAt(0, 0) === 0 && alphaAt(last, 0) === 0 && alphaAt(0, last) === 0 && alphaAt(last, last) === 0],
    ['launcher icon disc is opaque', alphaAt(Math.floor(last / 2), Math.floor(last / 2)) === 255],
    ['no adaptive icon XML (launchers must not re-mask)',
      !(await readFile(join(OUT, 'decoded', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'utf8').catch(() => null))],
    ['windowBackground=@color/app_background', /android:windowBackground">@color\/app_background/.test(styles)],
    ['no splash drawable in APK', !(await readFile(join(OUT, 'decoded', 'res', 'drawable', 'splash.xml'), 'utf8').catch(() => null))],
    ['no Capacitor vector fg', !(await readFile(join(OUT, 'decoded', 'res', 'drawable-v24', 'ic_launcher_foreground.xml'), 'utf8').catch(() => null))],
    ['themed icon disabled', /THEMED_ICON_ENABLED.*false/.test(manifest)],
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
