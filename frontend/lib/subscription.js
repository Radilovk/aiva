/**
 * Client-side subscription state and Stripe Checkout helpers.
 */
(function () {
  let cache = null;
  let cacheAt = 0;
  const CACHE_MS = 60_000;

  function t(key, vars) {
    return window.AIVA_I18N?.tf?.(key, vars) ?? window.AIVA_I18N?.t?.(key) ?? key;
  }

  function getUserId() {
    return localStorage.getItem('aiva_user_id') || localStorage.getItem('kaya_user_id') || '';
  }

  function getApiBase() {
    return window.AIVA_CONFIG?.API_BASE || window.AIVA_CONFIG?.WORKER_ORIGIN || location.origin;
  }

  async function fetchSubscription(force = false) {
    const userId = getUserId();
    if (!userId) return null;
    if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;

    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/api/subscription?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    cache = await res.json();
    cacheAt = Date.now();
    return cache;
  }

  function tierRank(tier) {
    return tier === 'pro' ? 2 : tier === 'plus' ? 1 : 0;
  }

  function hasPlus(data) {
    const tier = data?.tier || 'free';
    const status = data?.status || 'active';
    return tierRank(tier) >= 1 && (status === 'active' || status === 'trialing');
  }

  function canUseFeature(data, feature) {
    if (!data?.enforced) return true;
    const limits = data.limits || {};
    switch (feature) {
      case 'cloud_calendar':
        return !!limits.cloud_calendar;
      case 'daily_brief':
        return !!limits.daily_brief;
      case 'google_grounding':
        return !!limits.google_grounding;
      default:
        return true;
    }
  }

  async function openCheckout(planId) {
    const userId = getUserId();
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/api/stripe/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, plan: planId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed');
    if (data.url) {
      if (window.Capacitor?.Plugins?.Browser) {
        await window.Capacitor.Plugins.Browser.open({ url: data.url });
      } else {
        location.href = data.url;
      }
    }
  }

  async function openPortal() {
    const userId = getUserId();
    const apiBase = getApiBase();
    const res = await fetch(`${apiBase}/api/stripe/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Portal failed');
    if (data.url) {
      if (window.Capacitor?.Plugins?.Browser) {
        await window.Capacitor.Plugins.Browser.open({ url: data.url });
      } else {
        location.href = data.url;
      }
    }
  }

  function formatMoney(cents, currency) {
    const amount = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' }).format(amount);
    } catch {
      return `€${amount.toFixed(2)}`;
    }
  }

  function showPaywall(reason) {
    const modal = document.getElementById('paywallModal');
    if (!modal) return;
    const text = document.getElementById('paywallReason');
    const messages = {
      SESSION_LIMIT: t('paywallSessionLimit'),
      PLUS_REQUIRED: t('paywallCloudCal'),
      TASK_LIMIT: t('paywallTaskLimit'),
      BRIEF_LOCKED: t('paywallBrief'),
      GROUNDING_LOCKED: t('paywallGrounding'),
    };
    if (text) text.textContent = messages[reason] || t('paywallTitle');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
  }

  function hidePaywall() {
    const modal = document.getElementById('paywallModal');
    if (!modal) return;
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
  }

  window.AIVA_SUBSCRIPTION = {
    fetchSubscription,
    hasPlus,
    canUseFeature,
    openCheckout,
    openPortal,
    formatMoney,
    showPaywall,
    hidePaywall,
    getUserId,
    tierRank,
  };
})();
