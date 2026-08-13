/**
 * Email account auth — cross-device identity for web, PWA and APK.
 */
(function () {
  const SESSION_KEY = 'aiva_session_token';
  const EMAIL_KEY = 'aiva_account_email';

  function t(key, vars) {
    return window.AIVA_I18N?.tf?.(key, vars) ?? window.AIVA_I18N?.t?.(key) ?? key;
  }

  function getApiBase() {
    return window.AIVA_CONFIG?.API_BASE || window.AIVA_CONFIG?.WORKER_ORIGIN || location.origin;
  }

  function getUserId() {
    return localStorage.getItem('aiva_user_id') || localStorage.getItem('kaya_user_id') || '';
  }

  function ensureUserId() {
    let id = getUserId();
    if (!id) {
      id = `user_${crypto.randomUUID()}`;
      localStorage.setItem('aiva_user_id', id);
    }
    return id;
  }

  function getSessionToken() {
    return localStorage.getItem(SESSION_KEY) || '';
  }

  function getAccountEmail() {
    return localStorage.getItem(EMAIL_KEY) || '';
  }

  function isLoggedIn() {
    return !!getSessionToken() && !!getAccountEmail();
  }

  async function persistAuth(data) {
    localStorage.setItem(SESSION_KEY, data.token);
    localStorage.setItem(EMAIL_KEY, data.email);
    localStorage.setItem('aiva_user_id', data.user_id);
    localStorage.removeItem('aiva_tasks_etag');

    const prefs = window.Capacitor?.Plugins?.Preferences;
    if (prefs) {
      try {
        await prefs.set({ key: SESSION_KEY, value: data.token });
        await prefs.set({ key: EMAIL_KEY, value: data.email });
        await prefs.set({ key: 'aiva_user_id', value: data.user_id });
      } catch (e) {
        console.warn('Preferences persist:', e);
      }
    }
  }

  async function clearAuth() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem('aiva_tasks_etag');

    const prefs = window.Capacitor?.Plugins?.Preferences;
    if (prefs) {
      try {
        await prefs.remove({ key: SESSION_KEY });
        await prefs.remove({ key: EMAIL_KEY });
      } catch (e) {
        console.warn('Preferences clear:', e);
      }
    }
  }

  async function restoreFromPreferences() {
    if (getSessionToken()) return;
    const prefs = window.Capacitor?.Plugins?.Preferences;
    if (!prefs) return;

    try {
      const [token, userId, email] = await Promise.all([
        prefs.get({ key: SESSION_KEY }),
        prefs.get({ key: 'aiva_user_id' }),
        prefs.get({ key: EMAIL_KEY }),
      ]);
      if (token?.value && userId?.value) {
        localStorage.setItem(SESSION_KEY, token.value);
        localStorage.setItem('aiva_user_id', userId.value);
        if (email?.value) localStorage.setItem(EMAIL_KEY, email.value);
      }
    } catch (e) {
      console.warn('Preferences restore:', e);
    }
  }

  async function fetchMe() {
    const token = getSessionToken();
    if (!token) return null;
    const res = await fetch(`${getApiBase()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) await clearAuth();
      return null;
    }
    return res.json();
  }

  async function requestCode(email) {
    const res = await fetch(`${getApiBase()}/api/auth/request-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || t('accountErrGeneric'));
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function verifyCode(email, code) {
    const res = await fetch(`${getApiBase()}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        code,
        user_id: ensureUserId(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || t('accountErrGeneric'));
      err.code = data.code;
      throw err;
    }
    await persistAuth(data);
    return data;
  }

  async function restoreSubscription(email) {
    const res = await fetch(`${getApiBase()}/api/auth/restore-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email || getAccountEmail(),
        user_id: getUserId(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t('accountErrGeneric'));
    return data;
  }

  async function init() {
    await restoreFromPreferences();
    const me = await fetchMe();
    if (me?.user_id && me.user_id !== getUserId()) {
      localStorage.setItem('aiva_user_id', me.user_id);
      localStorage.removeItem('aiva_tasks_etag');
    }
    if (me?.email) localStorage.setItem(EMAIL_KEY, me.email);
    return me;
  }

  window.AIVA_ACCOUNT = {
    init,
    restoreFromPreferences,
    requestCode,
    verifyCode,
    restoreSubscription,
    fetchMe,
    persistAuth,
    clearAuth,
    getUserId,
    ensureUserId,
    getSessionToken,
    getAccountEmail,
    isLoggedIn,
  };
})();
