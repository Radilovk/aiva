/**
 * Google Calendar cloud sync — status, OAuth start, events for assistant.
 */
(function () {
  const { API_BASE, WORKER_ORIGIN } = window.AIVA_CONFIG || {};
  const RETURN_KEY = 'aiva_oauth_return';
  const STATUS_CACHE_KEY = 'aiva_google_cal_status';
  const STATUS_TTL_MS = 5 * 60 * 1000;
  const ACTIVATION_DISMISS_KEY = 'aiva_google_cal_dismissed_until';
  const ACTIVATION_DISMISS_DAYS = 7;

  let statusCache = null;
  let statusFetchedAt = 0;

  function t(key) {
    return window.AIVA_I18N?.t?.(key) ?? key;
  }

  function getApiBase() {
    return API_BASE || WORKER_ORIGIN || location.origin;
  }

  function getUserId() {
    return localStorage.getItem('aiva_user_id') || '';
  }

  function isWebPlatform() {
    if (window.Capacitor?.isNativePlatform?.()) return false;
    return true;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function getOAuthRedirectUri() {
    return new URL(window.AIVA_CONFIG.appUrl('settings.html'), location.origin).href;
  }

  function readCachedStatus() {
    if (statusCache && Date.now() - statusFetchedAt < STATUS_TTL_MS) {
      return statusCache;
    }
    try {
      const raw = sessionStorage.getItem(STATUS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - (parsed.fetchedAt || 0) < STATUS_TTL_MS) {
        statusCache = parsed.google || null;
        statusFetchedAt = parsed.fetchedAt || 0;
        return statusCache;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function writeCachedStatus(googleStatus) {
    statusCache = googleStatus;
    statusFetchedAt = Date.now();
    try {
      sessionStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({
        google: googleStatus,
        fetchedAt: statusFetchedAt,
      }));
    } catch {
      /* ignore */
    }
  }

  function clearStatusCache() {
    statusCache = null;
    statusFetchedAt = 0;
    try {
      sessionStorage.removeItem(STATUS_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function fetchGoogleStatus(force) {
    if (!force) {
      const cached = readCachedStatus();
      if (cached) return cached;
    }

    const userId = getUserId();
    if (!userId) return null;

    const res = await fetch(`${getApiBase()}/api/calendar/providers/status/${encodeURIComponent(userId)}`);
    if (!res.ok) return null;

    const data = await res.json().catch(() => ({}));
    const google = (data.providers || []).find((p) => p.provider === 'google') || null;
    writeCachedStatus(google);
    return google;
  }

  async function isConnected(force) {
    const status = await fetchGoogleStatus(force);
    return !!(status?.connected && status?.selectedCalendarId);
  }

  function normalizeCloudEvent(ev) {
    const start = ev.start || '';
    const end = ev.end || '';
    const startDate = start.includes('T') ? start.slice(0, 19) : start;
    const endDate = end.includes('T') ? end.slice(0, 19) : end;
    return {
      id: ev.id,
      eventId: ev.id,
      title: ev.title || 'Събитие',
      summary: ev.title || 'Събитие',
      startDate,
      endDate,
      source: 'google',
    };
  }

  async function fetchEvents(fromIso, toIso) {
    if (!isWebPlatform()) return [];

    const connected = await isConnected();
    if (!connected) return [];

    const userId = getUserId();
    if (!userId) return [];

    const from = fromIso || new Date().toISOString();
    const to = toIso || new Date(Date.now() + 14 * 86400000).toISOString();
    const params = new URLSearchParams({
      user_id: userId,
      provider: 'google',
      from,
      to,
    });

    const res = await fetch(`${getApiBase()}/api/calendar/events?${params}`);
    if (!res.ok) return [];

    const data = await res.json().catch(() => ({}));
    return (data.events || []).map(normalizeCloudEvent);
  }

  async function startConnect(options = {}) {
    if (!isWebPlatform()) {
      throw new Error('Google Calendar OAuth is only available on web');
    }

    const sub = await window.AIVA_SUBSCRIPTION?.fetchSubscription?.(true);
    if (sub?.enforced && !window.AIVA_SUBSCRIPTION?.canUseFeature?.(sub, 'cloud_calendar')) {
      window.AIVA_SUBSCRIPTION?.showPaywall?.('PLUS_REQUIRED');
      return false;
    }

    const userId = getUserId();
    if (!userId) {
      alert(t('errNoUserId') || 'Missing user ID');
      return false;
    }

    if (options.returnTo) {
      localStorage.setItem(RETURN_KEY, options.returnTo);
    } else {
      localStorage.removeItem(RETURN_KEY);
    }

    const res = await fetch(`${getApiBase()}/api/calendar/connect/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        provider: 'google',
        redirect_uri: getOAuthRedirectUri(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      if (data.code === 'PLUS_REQUIRED') {
        window.AIVA_SUBSCRIPTION?.showPaywall?.('PLUS_REQUIRED');
        return false;
      }
      alert(data.error || t('errOAuthStart') || 'OAuth start failed');
      return false;
    }

    localStorage.setItem('kaya_cloud_pending_provider', 'google');
    location.href = data.url;
    return true;
  }

  function markCalendarConfigured() {
    const api = window.AIVA_SETTINGS;
    if (!api) return;
    const current = api.loadAssistantSettings();
    api.saveAssistantSettings({
      ...current,
      calendarSync: {
        ...current.calendarSync,
        provider: 'google',
        setupComplete: true,
        preferredProvider: 'google',
        connectedAt: new Date().toISOString(),
      },
    });
  }

  function isActivationDismissed() {
    const until = localStorage.getItem(ACTIVATION_DISMISS_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  }

  function dismissActivation() {
    localStorage.setItem(
      ACTIVATION_DISMISS_KEY,
      String(Date.now() + ACTIVATION_DISMISS_DAYS * 86400000)
    );
  }

  async function maybePromptAfterOnboarding() {
    if (!isWebPlatform() || isIOS()) return;
    if (isActivationDismissed()) return;

    const connected = await isConnected();
    if (connected) return;

    const onboard = window.AIVA_CALENDAR_ONBOARD;
    if (onboard?.showGooglePrompt) {
      setTimeout(() => onboard.showGooglePrompt(), 1500);
    }
  }

  window.AIVA_GOOGLE_CAL = {
    isWebPlatform,
    isIOS,
    fetchGoogleStatus,
    isConnected,
    fetchEvents,
    startConnect,
    markCalendarConfigured,
    clearStatusCache,
    maybePromptAfterOnboarding,
    dismissActivation,
    getReturnPath: () => localStorage.getItem(RETURN_KEY) || '',
    clearReturnPath: () => localStorage.removeItem(RETURN_KEY),
    readCachedStatus,
  };

  window.addEventListener('aiva:calendar-connected', () => {
    clearStatusCache();
  });
})();
