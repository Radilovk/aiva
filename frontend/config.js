/**
 * API origin for Worker REST endpoints (/api/token, /api/tasks).
 * - wrangler dev / workers.dev: same origin as the page
 * - GitHub Pages / local file: must call the deployed Worker explicitly
 */
(function () {
  const WORKER_ORIGIN = 'https://aiva.radilov-k.workers.dev';

  /** Directory of the current page — works on Workers, GitHub Pages (/aiva/frontend/), and local dev. */
  function resolveAppBasePath() {
    if (window.Capacitor?.isNativePlatform?.()) return '/';

    const path = location.pathname;
    const slash = path.lastIndexOf('/');
    return slash >= 0 ? path.slice(0, slash + 1) : '/';
  }

  function appUrl(relativePath) {
    const base = resolveAppBasePath();
    const clean = String(relativePath || '').replace(/^\//, '');
    return `${base}${clean}`;
  }

  function resolveApiBase() {
    const host = location.hostname;

    // Capacitor APK serves the shell at https://localhost — there is no local API.
    if (window.Capacitor?.isNativePlatform?.()) {
      return WORKER_ORIGIN;
    }

    if (host === 'localhost' || host === '127.0.0.1') {
      return '';
    }
    if (host.endsWith('.github.io') || location.protocol === 'file:') {
      return WORKER_ORIGIN;
    }
    return location.origin;
  }

  window.AIVA_CONFIG = {
    API_BASE: resolveApiBase(),
    LIVE_MODEL: 'gemini-3.1-flash-live-preview',
    WORKER_ORIGIN,
    APP_BASE: resolveAppBasePath(),
    appUrl,
  };
})();
