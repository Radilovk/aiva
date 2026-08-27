/**
 * AIVA Local Notification Scheduler
 * Capacitor LocalNotifications in APK mode, Service Worker fallback in PWA.
 * Supports quiet hours, advance + at-time reminders, snooze, and action buttons.
 */
(function () {
  function t(key) {
    return window.AIVA_I18N?.t?.(key) ?? key;
  }

  function tf(key, vars) {
    return window.AIVA_I18N?.tf?.(key, vars) ?? t(key);
  }

  function getNotificationChannel() {
    return {
      id: 'aiva_tasks',
      name: t('channelTasks'),
      description: t('channelTasksDesc'),
      importance: 4,
      visibility: 1,
      vibration: true,
    };
  }

  function getSnoozeChannel() {
    return {
      id: 'aiva_snooze',
      name: t('channelSnooze'),
      description: t('channelSnoozeDesc'),
      importance: 4,
      visibility: 1,
      vibration: true,
    };
  }

  let isCapacitor = false;
  let LocalNotifications = null;
  let scheduledIds = new Set();
  let listenersBound = false;

  async function activateCapacitorNotifications() {
    if (!LocalNotifications) return false;
    await LocalNotifications.createChannel(getNotificationChannel());
    await LocalNotifications.createChannel(getSnoozeChannel());
    if (!listenersBound) {
      bindCapacitorListeners();
      listenersBound = true;
    }
    await processPendingAndroidActions();
    isCapacitor = true;
    return true;
  }

  function markNotifierReady() {
    window.dispatchEvent(new CustomEvent('aiva:notifier-ready'));
  }

  async function ensureNativeReady({ request = true } = {}) {
    if (!window.Capacitor?.isNativePlatform?.()) return false;
    if (isCapacitor && LocalNotifications) return true;

    try {
      LocalNotifications = window.Capacitor.Plugins?.LocalNotifications ||
        window.Capacitor.registerPlugin('LocalNotifications');
      if (!LocalNotifications) return false;

      let perm = await LocalNotifications.checkPermissions?.();
      if (perm?.display === 'granted') {
        return activateCapacitorNotifications();
      }
      if (!request) return false;
      if (perm?.display === 'prompt' || perm?.display === 'prompt-with-rationale') {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display === 'granted') {
        return activateCapacitorNotifications();
      }
    } catch (e) {
      console.warn('Capacitor notifications unavailable:', e);
    }
    return false;
  }

  function getSettings() {
    return window.AIVA_SETTINGS?.loadAssistantSettings?.()?.notifications || {};
  }

  function isEnabled() {
    return getSettings().enabled === true;
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function isInQuietHours(date) {
    const { quietHoursStart, quietHoursEnd } = getSettings();
    if (!quietHoursStart || !quietHoursEnd) return false;

    const minutes = date.getHours() * 60 + date.getMinutes();
    const start = parseTimeToMinutes(quietHoursStart);
    const end = parseTimeToMinutes(quietHoursEnd);

    if (start <= end) {
      return minutes >= start && minutes < end;
    }
    return minutes >= start || minutes < end;
  }

  function getTaskDateTime(task) {
    if (!task.due_date) return null;
    const [year, month, day] = task.due_date.split('-').map(Number);
    let hours = 9;
    let minutes = 0;
    if (task.due_time) {
      [hours, minutes] = task.due_time.split(':').map(Number);
    }
    return new Date(year, month - 1, day, hours, minutes);
  }

  function notifId(taskId, type) {
    const base = Math.abs(Number(taskId) || 0) % 1000000;
    const typeOffset = { advance: 0, start: 1000000, snooze: 2000000 }[type] || 0;
    return base + typeOffset;
  }

  async function init() {
    if (window.Capacitor?.isNativePlatform?.()) {
      await ensureNativeReady();
    } else if ('Notification' in window && Notification.permission === 'default') {
      // Don't auto-request on web — settings/onboarding handle it
    }

    if (!isCapacitor && 'serviceWorker' in navigator) {
      // Прецизен таймер до следващото напомняне вместо постоянен 15-сек. polling
      checkScheduledNotifications();
      armPreciseTimer();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkScheduledNotifications();
          armPreciseTimer();
        }
      });
    }
    markNotifierReady();
  }

  // --- Precise web timer (PWA fallback path) ---
  let webTimer = null;

  function armPreciseTimer() {
    if (isCapacitor) return; // нативните аларми се управляват от OS
    if (!('serviceWorker' in navigator)) return;
    if (webTimer) {
      clearTimeout(webTimer);
      webTimer = null;
    }

    let scheduled = [];
    try {
      scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
    } catch (_e) { /* повреден запис — таймерът просто не се навива */ }
    if (!scheduled.length) return;

    const now = Date.now();
    let nextAt = Infinity;
    for (const entry of scheduled) {
      const at = new Date(entry.at).getTime();
      if (Number.isFinite(at)) nextAt = Math.min(nextAt, at);
    }
    if (!Number.isFinite(nextAt)) return;

    // Просрочени, но потиснати от тихите часове записи: проверка веднъж в минута
    const delay = nextAt <= now ? 60000 : Math.min(nextAt - now + 250, 6 * 3600000);
    webTimer = setTimeout(() => {
      webTimer = null;
      checkScheduledNotifications();
      armPreciseTimer();
    }, delay);
  }

  function bindCapacitorListeners() {
    if (!LocalNotifications?.addListener) return;

    LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
      const action = event.actionId;
      const taskId = event.notification?.extra?.task_id;
      if (!taskId) return;

      if (action === 'done') {
        await markTaskDone(taskId);
      } else if (action === 'snooze') {
        await snoozeTask(taskId, event.notification?.extra?.content || t('defaultTaskLabel'));
      } else if (action === 'open') {
        window.location.href = './index.html';
      }
    });

    LocalNotifications.addListener('localNotificationReceived', (event) => {
      window.dispatchEvent(new CustomEvent('aiva:notification-fired', {
        detail: { taskId: event.notification?.extra?.task_id },
      }));
    });
  }

  async function processPendingAndroidActions() {
    try {
      const Prefs = window.Capacitor?.Plugins?.Preferences;
      if (!Prefs) return;

      const action = await Prefs.get({ key: 'pending_action' });
      const taskId = await Prefs.get({ key: 'pending_task_id' });
      const ts = await Prefs.get({ key: 'pending_timestamp' });

      if (action?.value === 'mark_done' && taskId?.value) {
        const age = Date.now() - Number(ts?.value || 0);
        if (age < 86400000) {
          await markTaskDone(taskId.value);
        }
        await Prefs.remove({ key: 'pending_action' });
        await Prefs.remove({ key: 'pending_task_id' });
        await Prefs.remove({ key: 'pending_timestamp' });
      }
    } catch (e) {
      console.warn('Pending notification actions:', e);
    }
  }

  function getUserId() {
    return localStorage.getItem('aiva_user_id') || localStorage.getItem('kaya_user_id') || '';
  }

  async function markTaskDone(taskId) {
    const apiBase = window.AIVA_CONFIG?.API_BASE || location.origin;
    const userId = getUserId();
    if (!userId) return;
    try {
      await fetch(`${apiBase}/api/tasks/${taskId}/done`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      await cancelForTask(taskId);
      window.dispatchEvent(new CustomEvent('aiva:task-done-from-notif', { detail: { taskId } }));
    } catch (e) {
      console.error('Mark done from notification:', e);
    }
  }

  async function scheduleNotification({ id, title, body, at, taskId, type, channelId }) {
    if (at <= new Date()) return false;
    if (isInQuietHours(at) && type !== 'snooze') return false;

    if (window.Capacitor?.isNativePlatform?.()) {
      await ensureNativeReady();
    }

    if (isCapacitor && LocalNotifications) {
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: channelId || getNotificationChannel().id,
          actionTypeId: 'aiva_task_reminder',
          extra: { task_id: taskId, content: body, type },
          sound: getSettings().sound !== false ? 'default' : undefined,
          actions: [
            { id: 'open', title: t('notifOpen') },
            { id: 'snooze', title: t('notifSnoozeAction') },
            { id: 'done', title: t('notifDone') },
          ],
        }],
      });
      scheduledIds.add(id);
      return true;
    }

    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
      const userId = getUserId();
      scheduled.push({
        id,
        task_id: taskId,
        user_id: userId,
        app_token: window.AIVA_AUTH?.getAppToken?.() || localStorage.getItem('aiva_app_token') || '',
        content: body,
        title,
        at: at.toISOString(),
        type,
      });
      localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(scheduled));
      armPreciseTimer();
      return true;
    }

    return false;
  }

  async function scheduleForTask(task, reminderMinutes) {
    if (!isEnabled()) return;
    if (!task.due_date) return;

    const settings = getSettings();
    const advanceMin = reminderMinutes ?? settings.reminderMinutes ?? 15;
    const remindAtStart = settings.remindAtStart !== false;
    const taskDate = getTaskDateTime(task);
    if (!taskDate) return;

    await cancelForTask(task.id);

    const advanceAt = new Date(taskDate.getTime() - advanceMin * 60000);
    if (advanceMin > 0) {
      await scheduleNotification({
        id: notifId(task.id, 'advance'),
        title: t('notifUpcomingTitle'),
        body: tf('notifAdvanceBody', { content: task.content, mins: advanceMin }),
        at: advanceAt,
        taskId: task.id,
        type: 'advance',
      });
    }

    if (remindAtStart && task.due_time) {
      await scheduleNotification({
        id: notifId(task.id, 'start'),
        title: t('notifStartingTitle'),
        body: task.content,
        at: taskDate,
        taskId: task.id,
        type: 'start',
      });
    }
  }

  async function snoozeTask(taskId, content, minutes = 10) {
    await cancelForTask(taskId);
    const at = new Date(Date.now() + minutes * 60000);
    await scheduleNotification({
      id: notifId(taskId, 'snooze'),
      title: t('notifSnoozeTitle'),
      body: content,
      at,
      taskId,
      type: 'snooze',
      channelId: getSnoozeChannel().id,
    });
  }

  async function cancelForTask(taskId) {
    const ids = [notifId(taskId, 'advance'), notifId(taskId, 'start'), notifId(taskId, 'snooze')];
    if (isCapacitor && LocalNotifications) {
      await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
      ids.forEach((id) => scheduledIds.delete(id));
    }
    const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
    const filtered = scheduled.filter((n) => String(n.task_id) !== String(taskId));
    localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(filtered));
    armPreciseTimer();
  }

  async function cancelAll() {
    if (isCapacitor && LocalNotifications) {
      const pending = await LocalNotifications.getPending?.();
      if (pending?.notifications?.length) {
        await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      }
    }
    scheduledIds.clear();
    localStorage.setItem('aiva_scheduled_notifs', '[]');
    localStorage.setItem(FP_KEY, '{}');
    armPreciseTimer();
  }

  // --- Delta scheduling ---
  // Fingerprint на всяка задача (дата/час/настройки на напомнянето). При
  // рефреш се (пре)насрочват само нови/променени задачи и се отменят само
  // изчезнали — без cancelAll/reschedule лавина от alarm заявки към OS.
  const FP_KEY = 'aiva_notif_fingerprints';

  function taskFingerprint(task, advanceMin, remindAtStart) {
    return [task.due_date, task.due_time || '', advanceMin, remindAtStart ? 1 : 0, task.content].join('|');
  }

  function readFingerprints() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FP_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  async function scheduleAll(tasks, reminderMinutes) {
    if (!isEnabled()) {
      await cancelAll();
      localStorage.setItem(FP_KEY, '{}');
      return;
    }

    const settings = getSettings();
    const advanceMin = reminderMinutes ?? settings.reminderMinutes ?? 15;
    const remindAtStart = settings.remindAtStart !== false;

    const prev = readFingerprints();
    const next = {};
    for (const task of tasks || []) {
      if (task.done || !task.due_date) continue;
      next[task.id] = taskFingerprint(task, advanceMin, remindAtStart);
    }

    // Отмени напомнянията на премахнати/завършени задачи
    for (const id of Object.keys(prev)) {
      if (!(id in next)) await cancelForTask(id);
    }

    // (Пре)насрочи само промените
    for (const task of tasks || []) {
      if (!(task.id in next)) continue;
      if (prev[task.id] === next[task.id]) continue;
      await scheduleForTask(task, advanceMin);
    }

    localStorage.setItem(FP_KEY, JSON.stringify(next));
    armPreciseTimer();
  }

  async function checkPermissions() {
    if (!window.Capacitor?.isNativePlatform?.()) {
      if (!('Notification' in window)) return false;
      return Notification.permission === 'granted';
    }
    try {
      const LN = LocalNotifications || window.Capacitor?.Plugins?.LocalNotifications;
      if (!LN?.checkPermissions) return false;
      const perm = await LN.checkPermissions();
      return perm?.display === 'granted';
    } catch {
      return false;
    }
  }

  async function requestPermission() {
    if (window.Capacitor?.isNativePlatform?.()) {
      return ensureNativeReady();
    }
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }
    return false;
  }

  function checkScheduledNotifications() {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;

    const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
    const now = new Date();
    // Тихите часове се проверяват спрямо "сега" — иначе запис, чийто час е
    // попаднал в тих период, оставаше блокиран завинаги.
    const quietNow = isInQuietHours(now);
    const remaining = [];

    for (const entry of scheduled) {
      const at = new Date(entry.at);
      if (at <= now && !quietNow) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(entry.title || '📋 KASY', {
            body: entry.content,
            tag: `aiva-${entry.id}`,
            icon: window.AIVA_CONFIG?.appUrl?.('icons/icon-192.png') || 'icons/icon-192.png',
            badge: window.AIVA_CONFIG?.appUrl?.('icons/icon-192.png') || 'icons/icon-192.png',
            data: {
              task_id: entry.task_id,
              user_id: entry.user_id || getUserId(),
              app_token: entry.app_token || window.AIVA_AUTH?.getAppToken?.() || localStorage.getItem('aiva_app_token') || '',
            },
            vibrate: [200, 100, 200],
            actions: [
              { action: 'open', title: t('notifOpen') },
              { action: 'snooze', title: t('notifSnoozeAction') },
              { action: 'done', title: t('notifDone') },
            ],
          });
        });
        window.dispatchEvent(new CustomEvent('aiva:notification-fired', {
          detail: { taskId: entry.task_id },
        }));
      } else {
        remaining.push(entry);
      }
    }

    localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(remaining));
  }

  /** Returns upcoming tasks within the next N hours for UI display. */
  function getUpcomingTasks(tasks, withinHours = 24) {
    const now = new Date();
    const limit = new Date(now.getTime() + withinHours * 3600000);
    const today = toISODate(now);

    return (tasks || [])
      .filter((t) => !t.done && t.due_date)
      .map((t) => {
        const dt = getTaskDateTime(t);
        return { task: t, dateTime: dt, msUntil: dt ? dt.getTime() - now.getTime() : Infinity };
      })
      .filter(({ dateTime, msUntil, task }) => {
        if (!dateTime) return false;
        if (msUntil < 0 && task.due_date === today) return true; // overdue today
        return dateTime >= now && dateTime <= limit;
      })
      .sort((a, b) => a.dateTime - b.dateTime);
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatCountdown(ms) {
    if (ms < 0) {
      const abs = Math.abs(ms);
      const mins = Math.floor(abs / 60000);
      if (mins < 60) return tf('countLateMin', { mins });
      const hrs = Math.floor(mins / 60);
      return tf('countLateHour', { hrs });
    }
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return t('countNow');
    if (mins < 60) return tf('countInMin', { mins });
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? tf('countInHourMin', { hrs, mins: rem }) : tf('countInHour', { hrs });
  }

  async function scheduleAt({ at, title, body, id }) {
    const when = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(when.getTime())) return false;
    return scheduleNotification({
      id: id ?? (Date.now() % 2147483647),
      title: title || 'KASY',
      body: body || '',
      at: when,
      taskId: null,
      type: 'device_reminder',
    });
  }

  window.AIVA_NOTIFIER = {
    init,
    ensureNativeReady,
    requestPermission,
    checkPermissions,
    scheduleForTask,
    scheduleAt,
    cancelForTask,
    cancelForTask,
    cancelAll,
    scheduleAll,
    snoozeTask,
    getUpcomingTasks,
    formatCountdown,
    isInQuietHours,
    isEnabled,
  };
})();
