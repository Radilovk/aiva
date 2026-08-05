/**
 * Debug-only logging — keeps production console clean (no Self-XSS confusion with app logs).
 * Enable: localStorage.setItem('aiva_debug', '1') or ?debug=1 in URL
 */
(function () {
  function isDebug() {
    try {
      if (typeof location !== 'undefined' && location.search.includes('debug=1')) return true;
      return localStorage.getItem('aiva_debug') === '1';
    } catch {
      return false;
    }
  }

  window.AIVA_LOG = {
    debug(...args) {
      if (isDebug()) console.log(...args);
    },
    info(...args) {
      if (isDebug()) console.info(...args);
    },
    warn(...args) {
      if (isDebug()) console.warn(...args);
    },
    error(...args) {
      console.error(...args);
    },
  };
})();
