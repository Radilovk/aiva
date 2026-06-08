/**
 * AIVA Calendar Sync
 *
 * Simplest cross-platform sync: ICS webcal subscription.
 * User subscribes once in Google / Apple / Samsung / Outlook and picks which
 * calendar to use. AIVA pushes task updates via the feed URL — no OAuth,
 * no native plugins.
 *
 * Manual mode keeps the per-task 📅 share flow from deviceCalendar.js.
 */
(function () {
  const { API_BASE, WORKER_ORIGIN } = window.AIVA_CONFIG;

  function getApiBase() {
    return API_BASE || WORKER_ORIGIN || location.origin;
  }

  function getUserId() {
    return localStorage.getItem('aiva_user_id') || '';
  }

  function getFeedUrl(userId) {
    const id = userId || getUserId();
    if (!id) return '';
    return `${getApiBase()}/api/calendar.ics?user_id=${encodeURIComponent(id)}`;
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
    return `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent('AIVA Задачи')}`;
  }

  function openSubscribe(provider, userId) {
    const urls = {
      google: getGoogleSubscribeUrl(userId),
      outlook: getOutlookSubscribeUrl(userId),
      apple: getWebcalUrl(userId),
    };
    const url = urls[provider] || getWebcalUrl(userId);
    if (!url) throw new Error('Липсва потребителски ID');

    // webcal: opens the device calendar app on iOS / many Android launchers
    if (provider === 'apple' || url.startsWith('webcal:')) {
      window.location.href = url;
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function buildMultiEventICS(tasks) {
    const withDates = (tasks || []).filter((t) => t.due_date);
    if (!withDates.length) return null;

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AIVA//Task Calendar//BG',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:AIVA Задачи',
      'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
      'X-PUBLISHED-TTL:PT15M',
    ];

    for (const task of withDates) {
      const block = window.AIVA_CALENDAR?.buildICS(task);
      if (!block) continue;
      const eventLines = block
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('BEGIN:VCALENDAR') && !line.startsWith('END:VCALENDAR'));
      lines.push(...eventLines);
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  async function shareICS(ics, fileName, title) {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const file = new File([blob], fileName, { type: 'text/calendar' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: title || 'AIVA задачи' });
      return 'shared';
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
    return shareICS(ics, 'aiva-tasks.ics', 'AIVA — всички задачи');
  }

  function getSyncSettings() {
    return window.AIVA_SETTINGS?.loadAssistantSettings?.()?.calendarSync || {};
  }

  function isSubscribeMode() {
    const provider = getSyncSettings().provider;
    return provider === 'subscribe' || provider === 'ics';
  }

  function isManualMode() {
    return getSyncSettings().provider === 'manual' || getSyncSettings().provider === 'device';
  }

  function isConfigured() {
    const sync = getSyncSettings();
    return !!sync.setupComplete && sync.provider && sync.provider !== 'none';
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

    if (isManualMode() && getSyncSettings().autoExportOnSave && window.AIVA_CALENDAR) {
      try {
        await window.AIVA_CALENDAR.addToDevice(task);
        return { action: 'shared' };
      } catch (e) {
        if (e?.name !== 'AbortError') console.warn('Calendar auto-export:', e);
      }
    }

    return { action: 'none' };
  }

  window.AIVA_CALENDAR_SYNC = {
    getFeedUrl,
    getWebcalUrl,
    getGoogleSubscribeUrl,
    getOutlookSubscribeUrl,
    openSubscribe,
    exportAllToDevice,
    buildMultiEventICS,
    onTaskSaved,
    handleTaskSaved,
    isSubscribeMode,
    isManualMode,
    isConfigured,
  };
})();
