# KASY / AIVA — App Icon (NutriPlan / aidiet parity)

## Pipeline (same as aidiet `build-apk.yml`)

```
icon1.png (raw export)
    → process-brand-assets.mjs
    → frontend/icons/icon-512.png   ← NutriPlan icon-512x512.png equivalent
    → generate-android-apk-assets.mjs
    → mipmap-* + adaptive XML
```

**APK never reads `icon1.png` directly** — only the processed `icon-512.png` tile.

## Raw export cleanup

`icon1.png` includes an opaque dark gray rounded card (~RGB 44,36,44).  
`removeCardMatte()` flood-fills from edges to strip the card; robot + pink glow remain.

## Adaptive icon

| Layer | Content |
|-------|---------|
| Foreground | `icon-512.png` scaled to 66.7% safe zone, transparent canvas |
| Background | `@color/ic_launcher_background` → `#050508` |

Legacy: direct resize of `icon-512.png` (transparent corners).

## Commands

```bash
npm install --prefix workers
node scripts/process-brand-assets.mjs
node scripts/generate-android-apk-assets.mjs android-res
node scripts/verify-apk-icon-preview.mjs
node scripts/simulate-launcher-icon.mjs   # visual compare vs NutriPlan
```

## Do NOT

- Point APK generation at `icon1.png` (bypasses card removal)
- Composite onto opaque `#050508` tile for launcher
- Use circular `renderApkCircle()` legacy-only icons
