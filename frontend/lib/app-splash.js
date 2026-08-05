/**
 * Unified splash: #appSplash + icons/splash.webp (contain, no crop).
 *
 * - APK (Capacitor): show branded splash until image paints, then dismiss on load.
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

  const splashImg = document.querySelector('#appSplash img');
  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    const el = document.getElementById('appSplash');
    if (!el || el.classList.contains('is-hidden')) return;
    el.classList.add('is-hidden');
    setTimeout(() => el.remove(), 350);
    window.Capacitor?.Plugins?.SplashScreen?.hide?.().catch(() => {});
  }

  function scheduleDismiss() {
    if (document.readyState === 'complete') dismiss();
    else window.addEventListener('load', dismiss, { once: true });
  }

  if (splashImg && !splashImg.complete) {
    splashImg.addEventListener('load', scheduleDismiss, { once: true });
    splashImg.addEventListener('error', scheduleDismiss, { once: true });
  } else {
    scheduleDismiss();
  }
})();
