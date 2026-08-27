/**
 * Client auth: per-device app_token + automatic Authorization header on API calls.
 */
(function () {
  const USER_KEY = 'aiva_user_id';
  const LEGACY_USER_KEY = 'kaya_user_id';
  const TOKEN_KEY = 'aiva_app_token';
  const ICS_KEY = 'aiva_ics_token';

  function getUserId() {
    let id = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
    if (!id) {
      id = 'user_' + crypto.randomUUID();
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  }

  function getAppToken() {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  }

  function getIcsFeedToken() {
    return localStorage.getItem(ICS_KEY) || '';
  }

  function apiBase() {
    return window.AIVA_CONFIG?.API_BASE || window.AIVA_CONFIG?.WORKER_ORIGIN || location.origin;
  }

  function authHeaders(extra) {
    return {
      Authorization: 'Bearer ' + getAppToken(),
      ...(extra || {}),
    };
  }

  function shouldAttachAuth(url) {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.startsWith('/api/')) return false;
      if (u.pathname === '/api/users/register') return false;
      return true;
    } catch {
      return false;
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (url && shouldAttachAuth(url)) {
      await ensureRegistered();
      const headers = new Headers((init && init.headers) || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', 'Bearer ' + getAppToken());
      }
      init = { ...(init || {}), headers };
    }
    return nativeFetch(input, init);
  };

  let registerPromise = null;

  async function ensureRegistered() {
    if (registerPromise) return registerPromise;
    registerPromise = (async () => {
      const res = await nativeFetch(apiBase() + '/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId(), app_token: getAppToken() }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.ics_feed_token) localStorage.setItem(ICS_KEY, data.ics_feed_token);
      }
      return res.ok;
    })();
    return registerPromise;
  }

  window.AIVA_AUTH = {
    getUserId,
    getAppToken,
    getIcsFeedToken,
    authHeaders,
    ensureRegistered,
  };

  ensureRegistered().catch(() => {});
})();
