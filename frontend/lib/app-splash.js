/**
 * Splash: native Android window shows splash_image; WebView splash only in browser/PWA.
 */
(function initAppSplash() {
  const isStandalonePwa = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const isNativeApk = /Capacitor/i.test(navigator.userAgent)
    || window.location.protocol === 'capacitor:'
    || (window.location.hostname === 'localhost' && /Android/i.test(navigator.userAgent));

  if (isNativeApk || isStandalonePwa) {
    document.documentElement.dataset.skipSplash = '1';
    window.Capacitor?.Plugins?.SplashScreen?.hide?.().catch(() => {});
    return;
  }

  function dismiss() {
    const el = document.getElementById('appSplash');
    if (!el || el.classList.contains('is-hidden')) return;
    el.classList.add('is-hidden');
    setTimeout(() => el.remove(), 350);
  }

  const splashImg = document.querySelector('#appSplash img');
  if (splashImg && !splashImg.complete) {
    splashImg.addEventListener('load', dismiss, { once: true });
    splashImg.addEventListener('error', dismiss, { once: true });
  } else if (document.readyState === 'complete') {
    dismiss();
  } else {
    window.addEventListener('load', dismiss, { once: true });
  }
})();
