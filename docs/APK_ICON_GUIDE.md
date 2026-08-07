# KASY APK Icon — Maskable Adaptive Pipeline

This document is the single source of truth for how KASY launcher icons are built for Android APK and PWA.

## 1. Source files

| File | Size | Role |
|------|------|------|
| `brand-assets/source/icon1.png` | Raw export (has dark gray card — stripped in pipeline) |
| `frontend/icons/icon-512.png` | **Launcher tile** — NutriPlan `icon-512x512.png` equivalent |
| `brand-assets/source/icon-512.png` | Copy of processed tile |

APK generation reads **only** `frontend/icons/icon-512.png` (never raw `icon1.png`).

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

PWA and APK share one visual: **large robot on transparent PNG**; launcher background `#050508` comes from adaptive `@color/ic_launcher_background` (NutriPlan uses `#042F2E`).

## 3. How icons are generated

### Step A — Brand assets (`scripts/process-brand-assets.mjs`)

1. Load raw export (`icon1.png`).
2. `removeCardMatte()` — flood from edges removes dark gray rounded card (RGB ~44,36,44).
3. `buildLauncherTile()` → transparent 512×512 PNG.
4. Write `frontend/icons/icon-512.png` — **this file is APK input** (aidiet uses `icon-512x512.png` the same way).

### Step B — APK mipmaps (`scripts/generate-android-apk-assets.mjs`)

Uses `frontend/icons/icon-512.png` only — direct resize like aidiet `build-apk.yml`:

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

Adaptive background: `@color/ic_launcher_background` → `#050508` in `values/colors.xml`.

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
| `scripts/simulate-launcher-icon.mjs` | Visual compare KASY vs NutriPlan under circle/squircle/teardrop masks |
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
