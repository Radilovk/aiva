/**
 * Runtime brand package resolver — applies pack A/B marks and listen assets.
 */
(function () {
  const STORAGE_KEY = 'aiva_assistant_settings_v1';
  const DEFAULT_PKG = 'B';

  const MARK = {
    A: { src: 'icons/pack-a/brand-mark.svg', type: 'image/svg+xml' },
    B: { src: 'icons/pack-b/brand-mark.webp', type: 'image/webp', fallback: 'icons/pack-b/brand-mark.png' },
  };

  const LISTEN = {
    A: { webp: 'icons/pack-a/listen-120.webp', png: 'icons/pack-a/listen-120.png' },
    B: { webp: 'icons/pack-b/listen-120.webp', png: 'icons/pack-b/listen-120.png' },
  };

  let activePackage = DEFAULT_PKG;
  let remoteLoaded = false;

  function normalizePkg(value) {
    const p = String(value || '').toUpperCase();
    return p === 'A' || p === 'B' ? p : DEFAULT_PKG;
  }

  function loadLocalPackage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PKG;
      const data = JSON.parse(raw);
      return normalizePkg(data.appearance?.brandPackage);
    } catch (e) {
      return DEFAULT_PKG;
    }
  }

  function markPath(pkg) {
    const m = MARK[normalizePkg(pkg)];
    return m.fallback ? m.src : m.src;
  }

  function applyBrandMark(el, pkg) {
    const p = normalizePkg(pkg);
    const conf = MARK[p];
    if (!conf) return;
    if (el.tagName === 'IMG') {
      if (conf.fallback) {
        const picture = el.closest('picture');
        if (picture) {
          const source = picture.querySelector('source');
          const img = picture.querySelector('img.brand-mark') || picture.querySelector('img');
          if (source) source.srcset = conf.src;
          if (img) img.src = conf.fallback;
        } else {
          el.src = conf.src;
        }
      } else {
        el.src = conf.src;
      }
    }
  }

  function applyListenAssets(pkg) {
    const p = normalizePkg(pkg);
    const conf = LISTEN[p];
    if (!conf) return;
    document.querySelectorAll('.listen-face, .hero-listen').forEach((img) => {
      const picture = img.closest('picture');
      if (picture) {
        const source = picture.querySelector('source[type="image/webp"]');
        if (source) source.srcset = conf.webp;
        img.src = conf.png;
      } else {
        img.src = conf.png;
      }
    });
  }

  function applyAll(pkg) {
    activePackage = normalizePkg(pkg);
    document.documentElement.dataset.brandPackage = activePackage;
    document.querySelectorAll('.brand-mark, [data-brand-mark]').forEach((el) => applyBrandMark(el, activePackage));
    applyListenAssets(activePackage);
  }

  async function fetchRemotePackage() {
    try {
      const base = window.AIVA_CONFIG?.API_BASE || '';
      const res = await fetch(`${base}/api/brand-config`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return normalizePkg(data.package);
    } catch (e) {
      return null;
    }
  }

  async function init() {
    const local = loadLocalPackage();
    applyAll(local);

    const remote = await fetchRemotePackage();
    remoteLoaded = true;
    if (remote && remote !== local) {
      applyAll(remote);
    }
  }

  async function setPackage(pkg, { persistLocal = true, persistRemote = true } = {}) {
    const p = normalizePkg(pkg);
    if (persistLocal) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        if (!data.appearance) data.appearance = {};
        data.appearance.brandPackage = p;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) { /* ignore */ }
    }
    if (persistRemote) {
      try {
        const base = window.AIVA_CONFIG?.API_BASE || '';
        await fetch(`${base}/api/admin/brand-package`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: p }),
        });
      } catch (e) {
        console.warn('Brand package remote save failed:', e);
      }
    }
    applyAll(p);
    return p;
  }

  window.AIVA_BRAND = {
    getPackage: () => activePackage,
    applyAll,
    setPackage,
    markPath,
    init,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('aiva:settings-updated', (ev) => {
    const pkg = ev.detail?.appearance?.brandPackage;
    if (pkg) applyAll(pkg);
  });
})();
