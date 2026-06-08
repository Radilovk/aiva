/**
 * Intuitive calendar setup — shown in-context when it matters,
 * not buried in settings.
 */
(function () {
  const DISMISS_KEY = 'aiva_calendar_dismissed_until';
  const DISMISS_DAYS = 14;

  function isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function detectPreferredProvider() {
    if (isIOS()) return 'apple';
    if (isAndroid() || isNative()) return 'google';
    return 'google';
  }

  function getProviderLabel(provider) {
    const labels = {
      google: 'Google Calendar',
      apple: 'Календара на устройството',
      outlook: 'Outlook',
    };
    return labels[provider] || 'календара';
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

  function isConfigured() {
    const sync = window.AIVA_SETTINGS?.loadAssistantSettings?.()?.calendarSync || {};
    return sync.setupComplete && sync.provider && sync.provider !== 'none';
  }

  function shouldPrompt(task) {
    if (!task?.due_date) return false;
    if (isConfigured()) return false;
    if (isDismissed()) return false;
    return true;
  }

  function updateHeaderStatus() {
    const chip = document.getElementById('calendarSyncChip');
    if (!chip) return;
    const sync = window.AIVA_SETTINGS?.loadAssistantSettings?.()?.calendarSync || {};
    if (sync.setupComplete && sync.provider === 'subscribe') {
      chip.hidden = false;
      chip.textContent = '📅 Календар';
      chip.title = 'Задачите се синхронизират автоматично';
    } else if (sync.setupComplete && sync.provider === 'manual') {
      chip.hidden = false;
      chip.textContent = '📅 Ръчен';
      chip.title = 'Новите задачи се предлагат за календар';
    } else {
      chip.hidden = true;
    }
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
    const primaryBtn = document.getElementById('calendarOnboardPrimary');
    const text = document.getElementById('calendarOnboardText');

    if (text) {
      text.textContent = task?.content
        ? `„${task.content}" има дата. Да я добавим в ${getProviderLabel(provider)}?`
        : `Задачите с дата могат да се появяват автоматично в ${getProviderLabel(provider)}.`;
    }
    if (primaryBtn) {
      primaryBtn.textContent = `Свържи с ${getProviderLabel(provider)}`;
      primaryBtn.dataset.provider = provider;
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

  async function enableAutoSync(provider, task) {
    clearDismiss();
    saveCalendarSettings({
      provider: 'subscribe',
      setupComplete: true,
      preferredProvider: provider || detectPreferredProvider(),
      subscribedAt: new Date().toISOString(),
      autoExportOnSave: false,
    });

    const sync = window.AIVA_CALENDAR_SYNC;
    if (sync) {
      sync.openSubscribe(provider || detectPreferredProvider());
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
      autoExportOnSave: true,
    });

    if (task?.due_date && window.AIVA_CALENDAR) {
      try {
        await window.AIVA_CALENDAR.addToDevice(task);
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Device calendar export:', e);
      }
    }

    updateHeaderStatus();
    updateBanner(false);
    window.dispatchEvent(new CustomEvent('aiva:calendar-connected'));
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
        // Gentle delayed prompt if user already has dated tasks but never connected
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
      const provider = document.getElementById('calendarOnboardPrimary')?.dataset.provider || detectPreferredProvider();
      const task = modal._pendingTask;
      hideModal();
      await enableAutoSync(provider, task);
    });

    document.getElementById('calendarOnboardDevice')?.addEventListener('click', async () => {
      const task = modal._pendingTask;
      hideModal();
      await enableDevicePerTask(task);
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

    document.getElementById('calendarSyncChip')?.addEventListener('click', () => {
      window.location.href = './settings.html#calendar-sync';
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        dismissTemporarily();
        hideModal();
      }
    });
  }

  window.AIVA_CALENDAR_ONBOARD = {
    detectPreferredProvider,
    isConfigured,
    shouldPrompt,
    maybePrompt,
    checkAfterLoad,
    enableAutoSync,
    enableDevicePerTask,
    updateHeaderStatus,
    bindUI,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }
})();
