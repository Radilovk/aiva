## KASY APK Icon — How It Works (NutriPlan / Icon.md pipeline)

Same proven pipeline as NutriPlan: one maskable master PNG → CI generates all Android densities.

### 1. Source file

| File | Size | Role |
|------|------|------|
| `PSX_*.png` or `brand-assets/source/` | raw robot art | Design input |
| `frontend/icons/icon-512.png` | **512×512** | **Maskable master** (APK + PWA) |
| `frontend/icons/icon-192.png` | 192×192 | PWA shortcuts / notifications |

`scripts/process-brand-assets.mjs` builds the maskable master:

- Background `#050508` (full tile, like NutriPlan `#042F2E`)
- Robot in **66.7% safe zone** (no clipping on OEM masks)

### 2. PWA (`frontend/manifest.json`)

```json
{
  "src": "icons/icon-512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "any maskable"
}
```

### 3. APK icon generation (CI)

`node scripts/generate-android-apk-assets.mjs` after `npx cap add android`.

**A) Legacy launcher icons** — direct resize of maskable master (no extra overlay):

| Density | Size | Files |
|---------|------|-------|
| mdpi | 48×48 | `mipmap-mdpi/ic_launcher.png`, `ic_launcher_round.png` |
| hdpi | 72×72 | `mipmap-hdpi/...` |
| xhdpi | 96×96 | `mipmap-xhdpi/...` |
| xxhdpi | 144×144 | `mipmap-xxhdpi/...` |
| xxxhdpi | 192×192 | `mipmap-xxxhdpi/...` |

**B) Adaptive icon (Android 8+)** — foreground + solid color background:

| Density | Canvas (108dp) | Icon safe zone (66.7%) |
|---------|----------------|------------------------|
| mdpi | 108×108 | 72×72 |
| hdpi | 162×162 | 108×108 |
| xhdpi | 216×216 | 144×144 |
| xxhdpi | 324×324 | 216×216 |
| xxxhdpi | 432×432 | 288×288 |

Foreground: transparent canvas, master resized to `SAFE = canvas × 2/3`, centered.

Background in `values/ic_launcher_background.xml`:

```xml
<color name="ic_launcher_background">#050508</color>
```

Adaptive XML (`mipmap-anydpi-v26/ic_launcher.xml`):

```xml
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
```

### 4. Notification icon

`capacitor.config.json` → `smallIcon: "ic_stat_aiva"`.

CI builds **alpha mask** per density (`drawable-mdpi` … `drawable-xxxhdpi`), same as NutriPlan `ic_stat_*` pipeline.

### 5. Flow

```
robot art (PSX_*.png)
        │
        ▼
process-brand-assets.mjs  →  icon-512.png (maskable 512×512)
        │
        ├──────────────────┬────────────────────┐
        ▼                  ▼                    ▼
  manifest.json    generate-android-apk-assets   browser favicon
  (PWA install)    → mipmap-* legacy + adaptive
                           │
                           ▼
                    APK home-screen icon
```

### 6. Rules (locked)

- APK launcher icon **matches** PWA maskable master — no white circles, borders, or extra overlays.
- Adaptive background is always `#050508`.
- Adaptive foreground canvas is **108dp × density** (not legacy launcher sizes).
- `android/` is generated at build time; `android-res/` holds patches + reference mipmaps.

**To change the icon:** update robot source art → `node scripts/process-brand-assets.mjs` → rebuild APK.
