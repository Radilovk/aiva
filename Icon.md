# KASY / AIVA — App Icon (locked spec, NutriPlan / aidiet style)

## Master source

| File | Role |
|------|------|
| `brand-assets/source/icon1.png` | **Preferred** master (robot PNG with alpha) |
| `brand-assets/source/icon-512.png` | Processed transparent launcher tile (512×512) |

Fallback: `PSX_20260805_210455.png`.

**Do not** use `frontend/icons/*` as generation input.

## Strategy (same as NutriPlan / aidiet)

- Master exports include an opaque black rounded card — `removeOpaqueMatte()` strips it before resize
- **Transparent PNG** with robot + pink glow only (like NutriPlan apple on transparency)
- **Legacy** `ic_launcher.png`: direct resize of source (transparent sides stay transparent)
- **Adaptive foreground**: source scaled to **66.7%** safe zone on transparent 108dp canvas
- **Adaptive background**: `@color/ic_launcher_background` → `#050508` (shows through transparent areas)

PWA `icon-512.png` matches APK source — not an opaque maskable tile with tiny artwork.

## Scripts

```bash
npm install --prefix workers
node scripts/process-brand-assets.mjs
node scripts/generate-android-apk-assets.mjs android-res
node scripts/verify-apk-icon-preview.mjs
```

## Do NOT

- Composite artwork onto opaque `#050508` for launcher/APK (`renderMaskableSquare` for APK)
- Shrink artwork to 66.7% on a full opaque tile (makes icon look small)
- Use circular `renderApkCircle()` pre-shaped bitmaps
- Delete `mipmap-anydpi-v26` adaptive XML

See `docs/APK_ICON_GUIDE.md` and https://github.com/Radilovk/aidiet (`icon-512x512.png` + `build-apk.yml`).
