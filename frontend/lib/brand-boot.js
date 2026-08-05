/**
 * Single brand image for logo, listen button, and launcher icon.
 * Static paths only — no runtime swapping (prevents flash and APK breakage).
 */
(function () {
  const ICON = 'icons/icon-512.webp';

  window.AIVA_BRAND = {
    iconPath: () => ICON,
  };
})();
