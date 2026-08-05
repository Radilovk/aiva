/**
 * Unified splash: #appSplash + icons/splash.webp (contain, no crop).
 *
 * - APK (Capacitor): show branded splash (native window is solid #050508 only).
 * - Browser tab: show branded splash on load.
 * - Installed PWA: skip — OS already shows launch frame (avoids double splash).
 */
(function initAppSplash() {
  const isStandalonePwa = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const isNativeApk = /Capacitor/i.test(navigator.userAgent)
    || window.location.protocol === 'capacitor:'
    || (window.location.hostname === 'localhost' && /Android/i.test(navigator.userAgent));

  if (isStandalonePwa && !isNativeApk) {
    document.documentElement.dataset.skipSplash = '1';
    return;
  }

  function dismiss() {
    const el = document.getElementById('appSplash');
    if (!el || el.classList.contains('is-hidden')) return;
    el.classList.add('is-hidden');
    setTimeout(() => el.remove(), 350);
    window.Capacitor?.Plugins?.SplashScreen?.hide?.().catch(() => {});
  }

  if (document.readyState === 'complete') dismiss();
  else window.addEventListener('load', dismiss, { once: true });
})();
