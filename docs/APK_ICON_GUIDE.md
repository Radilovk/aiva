# KASY APK Icon — Maskable Adaptive Pipeline

This document is the single source of truth for how KASY launcher icons are built for Android APK and PWA.

## 1. Source files

| File | Size | Role |
|------|------|------|
| `brand-assets/source/icon-512.png` | **512×512** | **Maskable master** — robot artwork on `#050508` background |
| `brand-assets/source/icon-192.png` | 192×192 | Smaller maskable master (notifications, shortcuts) |
| `PSX_20260805_210455.png` | raw | Fallback robot source for 512 master |
| `PSX_20260805_210411.png` | raw | Fallback robot source for 192 master |

Raw robot PNGs are trimmed and composited into maskable masters by `scripts/process-brand-assets.mjs`. The APK pipeline never reads raw PSX files directly — it uses the processed masters in `frontend/icons/` and `brand-assets/source/`.

## 2. Web / PWA registration

`frontend/manifest.json` registers the same maskable asset:

```json
{
  "src": "icons/icon-512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "any maskable"
}
```

PWA and APK share one visual: dark `#050508` tile, robot centered in the **66.7% safe zone**.

## 3. How icons are generated

### Step A — Brand assets (`scripts/process-brand-assets.mjs`)

1. Load raw robot PNG (`PSX_*.png` or existing source).
2. Trim transparent matte padding.
3. Build maskable master via `buildMaskableMaster()`:
   - Canvas: 512×512 (or 192×192)
   - Background: `#050508`
   - Artwork: scaled to **66.7%** of canvas (Android maskable safe zone)
4. Write to `frontend/icons/icon-{192,512}.png` and `brand-assets/source/`.

### Step B — APK mipmaps (`scripts/generate-android-apk-assets.mjs`)

Run after `npx cap add android` in CI, or locally:

```bash
node scripts/process-brand-assets.mjs
node scripts/generate-android-apk-assets.mjs android/app/src/main/res
```

**Legacy launcher icons** — direct resize of maskable master:

| Density | Output size | Files |
|---------|-------------|-------|
| mdpi | 48×48 | `mipmap-mdpi/ic_launcher.png`, `ic_launcher_round.png` |
| hdpi | 72×72 | `mipmap-hdpi/...` |
| xhdpi | 96×96 | `mipmap-xhdpi/...` |
| xxhdpi | 144×144 | `mipmap-xxhdpi/...` |
| xxxhdpi | 192×192 | `mipmap-xxxhdpi/...` |

**Adaptive icon (Android 8+)** — foreground layer + color background:

| Density | Canvas (108 dp) | Safe zone (66.7%) |
|---------|-----------------|-------------------|
| mdpi | 108×108 | 72×72 |
| hdpi | 162×162 | 108×108 |
| xhdpi | 216×216 | 144×144 |
| xxhdpi | 324×324 | 216×216 |
| xxxhdpi | 432×432 | 288×288 |

Adaptive foreground: transparent canvas, master scaled to safe zone, centered.

Adaptive background: `@color/ic_launcher_background` → `#050508` in `values/ic_launcher_background.xml`.

Adaptive XML (`mipmap-anydpi-v26/ic_launcher.xml`):

```xml
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
```

**No bitmap `ic_launcher_background.png`** — color drawable only (avoids duplicate-resource build errors).

### Notification icon

Monochrome alpha mask per density (`drawable-*/ic_stat_aiva.png`), extracted from the maskable master. Sizes: 24 / 36 / 48 / 72 / 96 px.

## 4. Verification

| Script | When | Checks |
|--------|------|--------|
| `scripts/verify-apk-icon-preview.mjs` | After generate, before APK build | 432px adaptive fg, 66.7% safe zone, no squircle clipping |
| `scripts/audit-apk.mjs` | After APK build | Correct fg dimensions, no Capacitor defaults, no splash |

CI runs both in `.github/workflows/build-apk.yml`.

## 5. Flow (summary)

```
PSX robot PNG  →  process-brand-assets.mjs  →  icon-512.png (maskable master)
                                                        │
                    ┌───────────────────────────────────┼───────────────────────┐
                    ▼                                   ▼                       ▼
            manifest.json                    generate-android-apk-assets.mjs   HTML favicon
            (PWA install)                    → mipmap-* legacy + adaptive      (browser tab)
                                                        │
                                                        ▼
                                              APK home-screen icon
```

## 6. Locked rules

- APK launcher icon **must match** the PWA maskable icon — no white circles, borders, or extra overlays.
- Adaptive background is always `#050508`.
- Safe zone is always **66.7%** (2/3) — artwork must not clip under launcher masks.
- Adaptive foreground layers use the **108 dp canvas** per density, not legacy 48 dp sizes.
- The `android/` folder is generated at build time; committed reference copies live in `android-res/`.
- Capacitor default vector foreground (`drawable-v24/ic_launcher_foreground.xml`) is removed.

**To change the APK icon:** update the robot source PNG → run `node scripts/process-brand-assets.mjs` → rebuild the APK. CI regenerates all densities automatically.
