# KASY / AIVA — App Icon (locked spec)

## Master source

| File | Role |
|------|------|
| `brand-assets/source/icon1.png` | **Preferred** master (1024×1024 robot PNG with alpha) |
| `brand-assets/source/icon-512.png` | Processed maskable master (512×512) |
| `brand-assets/source/icon-192.png` | Smaller master for notifications |

Fallback chain: `icon1.png` → `icon-512.png` → `PSX_20260805_210455.png`.

**Do not** use `frontend/icons/*` as generation input — those are outputs.

## Strategy: maskable adaptive (NOT circular legacy)

| Constant | Value |
|----------|-------|
| Background | `#050508` (opaque) |
| Safe zone | **66.7%** (72 dp of 108 dp) |
| Adaptive foreground canvas | 108 dp per density |
| Legacy launcher | 48 dp per density |

PWA icon = APK icon. Same maskable tile on dark background.

## Scripts (run order)

```bash
npm install --prefix workers
node scripts/process-brand-assets.mjs
node scripts/generate-android-apk-assets.mjs android-res
node scripts/verify-apk-icon-preview.mjs
```

CI runs the same pipeline into `android/app/src/main/res` after `npx cap add android`.

## Generated outputs (commit with scripts)

- `frontend/icons/icon-{192,512}.png`, `icon-512.webp`, `apple-touch-icon.png`
- `android-res/mipmap-*/ic_launcher.png` (legacy, opaque corners)
- `android-res/mipmap-*/ic_launcher_foreground.png` (adaptive, transparent corners)
- `android-res/mipmap-anydpi-v26/ic_launcher.xml` (adaptive definition)
- `android-res/values/colors.xml` (`app_background` + `ic_launcher_background`)

## Do NOT

- Use `renderApkCircle()` or pre-shaped circular bitmaps
- Delete `mipmap-anydpi-v26` or adaptive XML
- Commit only PNG binaries without script changes
- Use white `#FFFFFF` launcher background
- Copy NutriPlan docs without matching scripts

See `docs/APK_ICON_GUIDE.md` for troubleshooting.
