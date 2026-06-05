/**
 * API origin for Worker REST endpoints (/api/token, /api/tasks).
 * - wrangler dev / workers.dev: same origin as the page
 * - GitHub Pages / local file: must call the deployed Worker explicitly
 */
(function () {
  const WORKER_ORIGIN = 'https://aiva.radilov-k.workers.dev';

  function resolveApiBase() {
    const host = location.hostname;
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
  };
})();
