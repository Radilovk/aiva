/**
 * One-time device intelligence briefing after first APK install.
 * Shows detected phone/OS/apps data to help the user understand integration.
 */
(function () {
  const SHOWN_KEY = 'aiva_device_brief_v1';

  function t(key) {
    return window.AIVA_I18N?.t?.(key) ?? key;
  }

  function isAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  function shouldShow() {
    if (!isAndroid()) return false;
    return !localStorage.getItem(SHOWN_KEY);
  }

  function markShown() {
    localStorage.setItem(SHOWN_KEY, new Date().toISOString());
  }

  function formatUserBrief(intel) {
    if (!intel) return t('deviceBriefFallback');
    if (window.AIVA_DEVICE_ACCESS?.buildInfoHtml) {
      return window.AIVA_DEVICE_ACCESS.buildInfoHtml(intel);
    }
    const brand = intel.manufacturer || intel.brand || 'Android';
    const model = intel.model || '';
    const version = intel.androidVersion || '';
    return `${brand} ${model} · Android ${version}`;
  }

  function hide() {
    const overlay = document.getElementById('deviceIntelBrief');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    markShown();
  }

  async function showIfNeeded() {
    if (!shouldShow()) return;

    let intel = window.AIVA_DEVICE_INTEL?.readCache?.();
    if (!intel && window.AIVA_DEVICE_INTEL?.probe) {
      intel = await window.AIVA_DEVICE_INTEL.probe(true).catch(() => null);
    }
    if (!intel) {
      markShown();
      return;
    }

    const overlay = document.getElementById('deviceIntelBrief');
    const body = document.getElementById('deviceIntelBriefBody');
    if (!overlay || !body) return;

    body.textContent = formatUserBrief(intel);
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('visible');
  }

  window.AIVA_DEVICE_BRIEF = {
    shouldShow,
    showIfNeeded,
    hide,
    markShown,
  };
})();
