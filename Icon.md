## NutriPlan APK Icon — How It Works

### 1. Source file

The single source of truth is the PWA icon at the repo root:

| File | Size | Role |
|------|------|------|
| `icon-512x512.svg` | vector | Master design (teal apple outline, `#009A9E`) |
| `icon-512x512.png` | **512×512** | **APK build input** (maskable PNG) |
| `icon-192x192.png` | 192×192 | PWA / shortcuts / notifications on web |

The APK pipeline picks:

```bash
ICON_SRC="icon-512x512.png"   # fallback: icon-512.png
```

### 2. Where it is declared (web / PWA)

`manifest.json` registers the same assets for installable PWA:

```json
{
  "src": "/icon-512x512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "any maskable"
}
```

`twa-manifest.json` (Bubblewrap/TWA) points to the live URLs:

```json
"iconUrl": "https://biocode.website/icon-512x512.png",
"maskableIconUrl": "https://biocode.website/icon-512x512.png"
```

The Capacitor APK build does **not** use `twa-manifest.json` for icons; it uses the local PNG.

### 3. How the APK icon is generated (CI)

In `.github/workflows/build-apk.yml`, after `npx cap add android`, **ImageMagick** generates Android resources from `icon-512x512.png`:

**A) Legacy launcher icons** — direct resize, no extra background:

| Density | Output size | Files |
|---------|-------------|-------|
| mdpi | 48×48 | `mipmap-mdpi/ic_launcher.png`, `ic_launcher_round.png` |
| hdpi | 72×72 | `mipmap-hdpi/...` |
| xhdpi | 96×96 | `mipmap-xhdpi/...` |
| xxhdpi | 144×144 | `mipmap-xxhdpi/...` |
| xxxhdpi | 192×192 | `mipmap-xxxhdpi/...` |

```bash
convert "$ICON_SRC" -resize "${SIZE}x${SIZE}" "${ICON_DIR}/ic_launcher.png"
```

**B) Adaptive icon (Android 8+)** — foreground + solid background:

| Density | Canvas | Icon (66% safe zone) |
|---------|--------|----------------------|
| mdpi | 108×108 | 72×72 |
| hdpi | 162×162 | 108×108 |
| xhdpi | 216×216 | 144×144 |
| xxhdpi | 324×324 | 216×216 |
| xxxhdpi | 432×432 | 288×288 |

```bash
SAFE=$((SIZE * 2 / 3))   # 66.7% — avoids clipping by launcher shapes
convert -size "${SIZE}x${SIZE}" xc:none \
  \( "$ICON_SRC" -resize "${SAFE}x${SAFE}" \) \
  -gravity center -composite "${ICON_DIR}/ic_launcher_foreground.png"
```

Background color in `colors.xml`:

```xml
<color name="ic_launcher_background">#042F2E</color>
```

Capacitor wires this via the standard adaptive icon XML → `@mipmap/ic_launcher` in `AndroidManifest.xml`.

### 4. Notification icon (separate from launcher)

In `capacitor.config.json`:

```json
"LocalNotifications": {
  "smallIcon": "ic_stat_nutriplan",
  "iconColor": "#009A9E"
}
```

CI builds `ic_stat_nutriplan.png` as a **monochrome alpha mask** (alpha extract from the same source):

```bash
convert "$ICON_SRC" -resize "${SIZE}x${SIZE}" -alpha extract -threshold 1% \
  "drawable-${DPI}/ic_stat_nutriplan.png"
```

Sizes: 24 / 36 / 48 / 72 / 96 px per density.

### 5. Flow (summary)

```
icon-512x512.svg  →  export  →  icon-512x512.png (512×512)
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
            manifest.json         build-apk.yml         HTML <link rel="icon">
            (PWA install)    ImageMagick → mipmap-*   (browser tab)
                               ic_launcher + adaptive
                                        │
                                        ▼
                              APK home-screen icon
```

### 6. Rules (locked behavior)

From `android-res/APK_BUILD_REFERENCE.md`:

- APK launcher icon **must match** the PWA icon — no white circles, borders, or extra overlays.
- Adaptive background is always `#042F2E` (dark teal).
- The `android/` folder is generated at build time; icons are not committed — they are produced in CI from `icon-512x512.png`.

**To change the APK icon:** update `icon-512x512.svg` → re-export `icon-512x512.png` at 512×512 → rebuild the APK. CI will regenerate all `mipmap-*` densities automatically. 
