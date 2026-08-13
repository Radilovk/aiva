/**
 * AIVA Calendar Sync
 *
 * Cross-platform sync modes:
 *   subscribe  — ICS webcal feed (Google / Apple / Outlook)
 *   native     — Direct device calendar via native plugin (Android APK) + ICS fallback
 *   manual     — Per-task share flow
 */
(function () {
  const { API_BASE, WORKER_ORIGIN } = window.AIVA_CONFIG;

  function getApiBase() {
    return API_BASE || WORKER_ORIGIN || location.origin;
  }

  function getUserId() {
    return localStorage.getItem('aiva_user_id') || '';
  }

  function getReminderMinutes() {
    return window.AIVA_SETTINGS?.loadAssistantSettings?.()?.notifications?.reminderMinutes ?? 15;
  }

  function getFeedUrl(userId) {
    const id = userId || getUserId();
    if (!id) return '';
    const reminder = getReminderMinutes();
    return `${getApiBase()}/api/calendar.ics?user_id=${encodeURIComponent(id)}&reminder=${reminder}`;
  }

  function getWebcalUrl(userId) {
    const feed = getFeedUrl(userId);
    return feed ? feed.replace(/^https?:/, 'webcal:') : '';
  }

  function getGoogleSubscribeUrl(userId) {
    const webcal = getWebcalUrl(userId);
    return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  }

  function getOutlookSubscribeUrl(userId) {
    const feed = getFeedUrl(userId);
    return `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent('KASY Задачи')}`;
  }

  function getSamsungSubscribeUrl(userId) {
    const webcal = getWebcalUrl(userId);
    return `samsungcalendar://add?url=${encodeURIComponent(webcal)}`;
  }

  function openSubscribe(provider, userId) {
    const urls = {
      google: getGoogleSubscribeUrl(userId),
      outlook: getOutlookSubscribeUrl(userId),
      apple: getWebcalUrl(userId),
      samsung: getSamsungSubscribeUrl(userId),
    };
    const url = urls[provider] || getWebcalUrl(userId);
    if (!url) throw new Error('Липсва потребителски ID');

    if (provider === 'apple' || url.startsWith('webcal:') || url.startsWith('samsungcalendar:')) {
      window.location.href = url;
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function buildMultiEventICS(tasks) {
    const opts = {
      reminderMinutes: getReminderMinutes(),
      remindAtStart: window.AIVA_SETTINGS?.loadAssistantSettings?.()?.notifications?.remindAtStart !== false,
      calendarName: 'KASY Задачи',
      includeRefresh: true,
    };
    return window.AIVA_ICS?.buildMultiICS(tasks, opts) || null;
  }

  async function shareICS(ics, fileName, title, options = {}) {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const file = new File([blob], fileName, { type: 'text/calendar' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: title || 'KASY задачи' });
      return 'shared';
    }

    if (options.allowDownload === false) {
      throw new Error('Споделянето не е налично в този браузър');
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  }

  async function exportAllToDevice(tasks) {
    const ics = buildMultiEventICS(tasks);
    if (!ics) throw new Error('Няма задачи с дата за експорт');
    return shareICS(ics, 'aiva-tasks.ics', 'KASY — всички задачи', { allowDownload: true });
  }

  function getSyncSettings() {
    return window.AIVA_SETTINGS?.loadAssistantSettings?.()?.calendarSync || {};
  }

  function isSubscribeMode() {
    const provider = getSyncSettings().provider;
    return provider === 'subscribe' || provider === 'ics';
  }

  function isNativeMode() {
    return getSyncSettings().provider === 'native';
  }

  function isManualMode() {
    return getSyncSettings().provider === 'manual' || getSyncSettings().provider === 'device';
  }

  function isConfigured() {
    const sync = getSyncSettings();
    return !!sync.setupComplete && sync.provider && sync.provider !== 'none';
  }

  async function syncTaskToCalendar(task) {
    if (!task?.due_date) return { action: 'skip' };

    if (isNativeMode() && window.AIVA_CALENDAR_CRUD?.isAndroid?.()) {
      try {
        const crud = window.AIVA_CALENDAR_CRUD;
        if (crud.hasLocalEvent(task.id)) {
          const result = await crud.updateAivaEvent(task);
          return { action: 'updated', method: 'android-local', ...result };
        }
        const result = await crud.createAivaEvent(task);
        return { action: 'native', method: 'android-local', ...result };
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Android local calendar sync:', e);
      }
    }

    if (isNativeMode() && window.AIVA_NATIVE_CALENDAR) {
      try {
        const result = await window.AIVA_NATIVE_CALENDAR.syncTaskToDevice(task);
        return { action: 'native', ...result };
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Native calendar sync:', e);
      }
    }

    if (isManualMode() && getSyncSettings().autoExportOnSave && window.AIVA_NATIVE_CALENDAR) {
      const platform = window.AIVA_NATIVE_CALENDAR.getPlatform?.();
      // Only Android APK silently writes on save; web never auto-downloads
      if (platform === 'android-native') {
        try {
          const result = await window.AIVA_NATIVE_CALENDAR.addToDeviceCalendar(task);
          if (result?.method !== 'aborted') return { action: 'shared', ...result };
        } catch (e) {
          if (e?.name !== 'AbortError') console.warn('Manual calendar export:', e);
        }
      }
    }

    return { action: 'none' };
  }

  async function onTaskSaved(task) {
    return handleTaskSaved(task);
  }

  async function handleTaskSaved(task, options = {}) {
    if (!task?.due_date) return { action: 'skip' };

    const onboard = window.AIVA_CALENDAR_ONBOARD;
    if (onboard && !isConfigured() && !options.skipPrompt) {
      if (onboard.maybePrompt(task)) return { action: 'prompted' };
    }

    if (isSubscribeMode()) {
      if (options.showToast !== false && typeof window.showCalendarSyncToast === 'function') {
        window.showCalendarSyncToast(task);
      }
      return { action: 'subscribed' };
    }

    const syncResult = await syncTaskToCalendar(task);
    if (syncResult.action !== 'none') return syncResult;

    // Schedule local notification for new/updated task
    if (window.AIVA_NOTIFIER?.isEnabled?.()) {
      const mins = window.AIVA_SETTINGS?.loadAssistantSettings?.()?.notifications?.reminderMinutes;
      await window.AIVA_NOTIFIER.scheduleForTask(task, mins);
    }

    return { action: 'none' };
  }

  async function syncIncomingEvents(startDate, endDate) {
    const crud = window.AIVA_CALENDAR_CRUD;
    if (!crud?.isAndroid?.() || !crud.getSelectedCalendarId()) return [];
    try {
      const { events = [] } = await crud.readAivaEvents({ from: startDate, to: endDate });
      const localIds = crud.getLocalEventIds?.() || new Set();
      return events
        .filter((ev) => !localIds.has(String(ev.eventId || ev.id || '')))
        .map((ev) => ({
          id: `ext_${ev.eventId || ev.id || Math.random().toString(36).slice(2)}`,
          calendarEventId: String(ev.eventId || ev.id || ''),
          content: ev.title || ev.summary || 'Външно събитие',
          due_date: ev.startDate ? ev.startDate.slice(0, 10) : null,
          due_time: ev.startDate ? ev.startDate.slice(11, 16) : null,
          end_date: ev.endDate ? ev.endDate.slice(0, 10) : null,
          end_time: ev.endDate ? ev.endDate.slice(11, 16) : null,
          priority: 3,
          emotion: 'neutral',
          isExternal: true,
        }));
    } catch (e) {
      console.warn('syncIncomingEvents:', e);
      return [];
    }
  }

  async function onTaskRemoved(taskId) {
    if (window.AIVA_CALENDAR_CRUD?.isAndroid?.()) {
      try {
        await window.AIVA_CALENDAR_CRUD.deleteAivaEvent(taskId);
      } catch (e) {
        console.warn('Android local calendar remove:', e);
      }
    }
    if (window.AIVA_NATIVE_CALENDAR?.removeFromDeviceCalendar) {
      await window.AIVA_NATIVE_CALENDAR.removeFromDeviceCalendar(taskId);
    }
    if (window.AIVA_NOTIFIER?.cancelForTask) {
      await window.AIVA_NOTIFIER.cancelForTask(taskId);
    }
  }

  async function onTaskDone(taskId) {
    await onTaskRemoved(taskId);
  }

  window.AIVA_CALENDAR_SYNC = {
    getFeedUrl,
    getWebcalUrl,
    getGoogleSubscribeUrl,
    getOutlookSubscribeUrl,
    getSamsungSubscribeUrl,
    openSubscribe,
    exportAllToDevice,
    buildMultiEventICS,
    onTaskSaved,
    handleTaskSaved,
    onTaskRemoved,
    onTaskDone,
    syncTaskToCalendar,
    isSubscribeMode,
    isNativeMode,
    isManualMode,
    isConfigured,
    syncIncomingEvents,
  };
})();
