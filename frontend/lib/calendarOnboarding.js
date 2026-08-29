/**
 * Intuitive calendar + notification setup — shown in-context when it matters.
 */
(function () {
  const DISMISS_KEY = 'aiva_calendar_dismissed_until';
  const DISMISS_DAYS = 14;

  function t(key) {
    return window.AIVA_I18N?.t?.(key) ?? key;
  }

  function tf(key, vars) {
    return window.AIVA_I18N?.tf?.(key, vars) ?? t(key);
  }

  function isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function detectPreferredProvider() {
    if (isIOS()) return 'apple';
    if (isAndroid()) {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('samsung')) return 'samsung';
      return 'google';
    }
    return 'google';
  }

  function detectRecommendedMode() {
    if (isNative() && isAndroid()) return 'native';
    if (isIOS()) return 'subscribe';
    return 'cloud';
  }

  function getProviderLabel(provider) {
    const labels = {
      google: 'Google Calendar',
      apple: 'Apple Calendar',
      samsung: 'Samsung Calendar',
      outlook: 'Outlook',
    };
    return labels[provider] || t('calendar');
  }

  function isDismissed() {
    const until = localStorage.getItem(DISMISS_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  }

  function dismissTemporarily() {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000));
  }

  function clearDismiss() {
    localStorage.removeItem(DISMISS_KEY);
  }

  function saveCalendarSettings(patch) {
    const { loadAssistantSettings, saveAssistantSettings } = window.AIVA_SETTINGS;
    const current = loadAssistantSettings();
    saveAssistantSettings({
      ...current,
      calendarSync: { ...current.calendarSync, ...patch },
    });
  }

  function saveNotificationSettings(patch) {
    const { loadAssistantSettings, saveAssistantSettings } = window.AIVA_SETTINGS;
    const current = loadAssistantSettings();
    saveAssistantSettings({
      ...current,
      notifications: { ...current.notifications, ...patch },
    });
  }

  function isConfigured() {
    const sync = window.AIVA_SETTINGS?.loadAssistantSettings?.()?.calendarSync || {};
    if (sync.setupComplete && sync.provider && sync.provider !== 'none') return true;
    if (window.AIVA_GOOGLE_CAL?.readCachedStatus?.()) {
      const cached = window.AIVA_GOOGLE_CAL.readCachedStatus();
      if (cached?.connected && cached?.selectedCalendarId) return true;
    }
    return false;
  }

  function shouldPrompt(task) {
    if (!task?.due_date) return false;
    if (isConfigured()) return false;
    if (isDismissed()) return false;
    return true;
  }

  function updateHeaderStatus() {
    const chip = document.getElementById('calendarSyncChip');
    if (chip) chip.hidden = true;
  }

  function updateBanner(hasDatedTasks) {
    const banner = document.getElementById('calendarBanner');
    if (!banner) return;
    banner.hidden = isConfigured() || !hasDatedTasks || isDismissed();
  }

  function showModal(task) {
    const modal = document.getElementById('calendarOnboard');
    if (!modal) return;

    const provider = detectPreferredProvider();
    const mode = detectRecommendedMode();
    const primaryBtn = document.getElementById('calendarOnboardPrimary');
    const text = document.getElementById('calendarOnboardText');
    const deviceBtn = document.getElementById('calendarOnboardDevice');

    const platformLabel = window.AIVA_NATIVE_CALENDAR?.getPlatformLabel?.() || getProviderLabel(provider);

    if (text) {
      if (mode === 'cloud') {
        text.textContent = task?.content
          ? tf('calOnboardWithTask', { task: task.content, calendar: 'Google Calendar' })
          : t('calOnboardGoogleWeb');
      } else {
        text.textContent = task?.content
          ? tf('calOnboardWithTask', { task: task.content, calendar: platformLabel })
          : t('calOnboardDefault');
      }
    }

    if (primaryBtn) {
      if (mode === 'native') {
        primaryBtn.textContent = t('addPhoneCal');
        primaryBtn.dataset.mode = 'native';
      } else if (mode === 'cloud') {
        primaryBtn.textContent = tf('connectProvider', { provider: 'Google Calendar' });
        primaryBtn.dataset.mode = 'cloud';
      } else {
        primaryBtn.textContent = tf('connectProvider', { provider: getProviderLabel(provider) });
        primaryBtn.dataset.mode = 'subscribe';
        primaryBtn.dataset.provider = provider;
      }
    }

    if (deviceBtn) {
      if (mode === 'native') {
        deviceBtn.textContent = t('onlyThisIcs');
      } else if (mode === 'cloud') {
        deviceBtn.textContent = t('onlyThisIcs');
      } else {
        deviceBtn.textContent = t('onlyThisTask');
      }
    }

    modal._pendingTask = task || null;
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
  }

  function hideModal() {
    const modal = document.getElementById('calendarOnboard');
    if (!modal) return;
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    modal._pendingTask = null;
  }

  async function enableNotifications() {
    if (!window.AIVA_NOTIFIER) return false;
    const granted = await window.AIVA_NOTIFIER.requestPermission();
    saveNotificationSettings({ enabled: granted });
    return granted;
  }

  async function enableCloudGoogleSync() {
    clearDismiss();
    await window.AIVA_GOOGLE_CAL?.startConnect?.({ returnTo: window.AIVA_CONFIG?.appUrl?.('index.html') || 'index.html' });
  }

  async function enableAutoSync(provider, task) {
    clearDismiss();
    saveCalendarSettings({
      provider: 'subscribe',
      setupComplete: true,
      preferredProvider: provider || detectPreferredProvider(),
      subscribedAt: new Date().toISOString(),
      autoExportOnSave: false,
    });

    await enableNotifications();

    const sync = window.AIVA_CALENDAR_SYNC;
    if (sync) {
      sync.openSubscribe(provider || detectPreferredProvider());
    }

    updateHeaderStatus();
    updateBanner(false);
    window.dispatchEvent(new CustomEvent('aiva:calendar-connected'));
  }

  async function enableNativeSync(task) {
    clearDismiss();
    saveCalendarSettings({
      provider: 'native',
      setupComplete: true,
      preferredProvider: 'android-native',
      autoExportOnSave: false,
    });

    await enableNotifications();

    if (task?.due_date && window.AIVA_NATIVE_CALENDAR) {
      try {
        await window.AIVA_NATIVE_CALENDAR.addToDeviceCalendar(task);
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Native calendar setup:', e);
      }
    }

    updateHeaderStatus();
    updateBanner(false);
    window.dispatchEvent(new CustomEvent('aiva:calendar-connected'));
  }

  async function enableDevicePerTask(task) {
    clearDismiss();
    saveCalendarSettings({
      provider: 'manual',
      setupComplete: true,
      autoExportOnSave: false,
    });

    await enableNotifications();

    if (task?.due_date && window.AIVA_NATIVE_CALENDAR) {
      try {
        await window.AIVA_NATIVE_CALENDAR.addToDeviceCalendar(task);
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Device calendar export:', e);
      }
    }

    updateHeaderStatus();
    updateBanner(false);
    window.dispatchEvent(new CustomEvent('aiva:calendar-connected'));
  }

  function showGooglePrompt() {
    if (isConfigured() || isDismissed()) return false;
    showModal(null);
    return true;
  }

  function maybePrompt(task) {
    if (!shouldPrompt(task)) return false;
    showModal(task);
    return true;
  }

  function checkAfterLoad(tasks) {
    updateHeaderStatus();
    const hasDated = (tasks || []).some((t) => t.due_date);
    updateBanner(hasDated);
    if (!isConfigured() && hasDated && !isDismissed()) {
      const modal = document.getElementById('calendarOnboard');
      if (modal && !modal.classList.contains('visible')) {
        setTimeout(() => {
          if (!isConfigured() && !isDismissed()) showModal(null);
        }, 1200);
      }
    }
  }

  function bindUI() {
    const modal = document.getElementById('calendarOnboard');
    if (!modal || modal._bound) return;
    modal._bound = true;

    document.getElementById('calendarOnboardPrimary')?.addEventListener('click', async () => {
      const btn = document.getElementById('calendarOnboardPrimary');
      const mode = btn?.dataset.mode || 'subscribe';
      const provider = btn?.dataset.provider || detectPreferredProvider();
      const task = modal._pendingTask;
      hideModal();

      if (mode === 'native') {
        await enableNativeSync(task);
      } else if (mode === 'cloud') {
        await enableCloudGoogleSync();
      } else {
        await enableAutoSync(provider, task);
      }
    });

    document.getElementById('calendarOnboardDevice')?.addEventListener('click', async () => {
      const task = modal._pendingTask;
      const mode = document.getElementById('calendarOnboardPrimary')?.dataset.mode || 'subscribe';
      hideModal();
      if (mode === 'cloud') {
        await enableAutoSync('google', task);
      } else {
        await enableDevicePerTask(task);
      }
    });

    document.getElementById('calendarOnboardLater')?.addEventListener('click', () => {
      dismissTemporarily();
      hideModal();
      updateBanner(true);
    });

    document.getElementById('calendarOnboardClose')?.addEventListener('click', () => {
      dismissTemporarily();
      hideModal();
    });

    document.getElementById('calendarBannerConnect')?.addEventListener('click', () => {
      showModal(null);
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        dismissTemporarily();
        hideModal();
      }
    });
  }

  async function prefetchCloudStatus() {
    if (!window.AIVA_GOOGLE_CAL?.fetchGoogleStatus) return;
    try {
      await window.AIVA_GOOGLE_CAL.fetchGoogleStatus();
      updateHeaderStatus();
    } catch {
      /* ignore */
    }
  }

  window.AIVA_CALENDAR_ONBOARD = {
    detectPreferredProvider,
    detectRecommendedMode,
    isConfigured,
    shouldPrompt,
    maybePrompt,
    showGooglePrompt,
    checkAfterLoad,
    enableAutoSync,
    enableCloudGoogleSync,
    enableNativeSync,
    enableDevicePerTask,
    enableNotifications,
    updateHeaderStatus,
    bindUI,
    prefetchCloudStatus,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }
})();
