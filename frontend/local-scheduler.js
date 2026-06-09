/**
 * AIVA Local Notification Scheduler
 * Capacitor LocalNotifications in APK mode, Service Worker fallback in PWA.
 * Supports quiet hours, advance + at-time reminders, snooze, and action buttons.
 */
(function () {
  const NOTIFICATION_CHANNEL = {
    id: 'aiva_tasks',
    name: 'AIVA Задачи',
    description: 'Напомняния за задачи',
    importance: 4,
    visibility: 1,
    vibration: true,
  };

  const SNOOZE_CHANNEL = {
    id: 'aiva_snooze',
    name: 'AIVA Отложени',
    description: 'Отложени напомняния',
    importance: 4,
    visibility: 1,
    vibration: true,
  };

  let isCapacitor = false;
  let LocalNotifications = null;
  let scheduledIds = new Set();

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
      try {
        LocalNotifications = window.Capacitor.Plugins?.LocalNotifications ||
          window.Capacitor.registerPlugin('LocalNotifications');
        const perm = await LocalNotifications.requestPermissions();
        if (perm.display === 'granted') {
          await LocalNotifications.createChannel(NOTIFICATION_CHANNEL);
          await LocalNotifications.createChannel(SNOOZE_CHANNEL);
          isCapacitor = true;
          bindCapacitorListeners();
          await processPendingAndroidActions();
          console.log('🔔 Capacitor notifications ready');
        }
      } catch (e) {
        console.warn('Capacitor notifications unavailable:', e);
      }
    }

    if (!isCapacitor && 'Notification' in window && Notification.permission === 'default') {
      // Don't auto-request — let onboarding/settings handle it
    }

    if ('serviceWorker' in navigator) {
      setInterval(checkScheduledNotifications, 15000);
    }
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
        await snoozeTask(taskId, event.notification?.extra?.content || 'Задача');
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

  async function markTaskDone(taskId) {
    const apiBase = window.AIVA_CONFIG?.API_BASE || location.origin;
    try {
      await fetch(`${apiBase}/api/tasks/${taskId}/done`, { method: 'PATCH' });
      await cancelForTask(taskId);
      window.dispatchEvent(new CustomEvent('aiva:task-done-from-notif', { detail: { taskId } }));
    } catch (e) {
      console.error('Mark done from notification:', e);
    }
  }

  async function scheduleNotification({ id, title, body, at, taskId, type, channelId }) {
    if (at <= new Date()) return false;
    if (isInQuietHours(at) && type !== 'snooze') return false;

    if (isCapacitor && LocalNotifications) {
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          channelId: channelId || NOTIFICATION_CHANNEL.id,
          actionTypeId: 'aiva_task_reminder',
          extra: { task_id: taskId, content: body, type },
          sound: getSettings().sound !== false ? 'default' : undefined,
          actions: [
            { id: 'open', title: 'Отвори' },
            { id: 'snooze', title: '⏰ +10 мин' },
            { id: 'done', title: 'Готово ✓' },
          ],
        }],
      });
      scheduledIds.add(id);
      return true;
    }

    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
      scheduled.push({ id, task_id: taskId, content: body, title, at: at.toISOString(), type });
      localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(scheduled));
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
        title: '⏰ Предстои задача',
        body: `${task.content} след ${advanceMin} мин`,
        at: advanceAt,
        taskId: task.id,
        type: 'advance',
      });
    }

    if (remindAtStart && task.due_time) {
      await scheduleNotification({
        id: notifId(task.id, 'start'),
        title: '▶️ Започва сега',
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
      title: '⏰ Напомняне',
      body: content,
      at,
      taskId,
      type: 'snooze',
      channelId: SNOOZE_CHANNEL.id,
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
  }

  async function scheduleAll(tasks, reminderMinutes) {
    if (!isEnabled()) return;
    await cancelAll();
    for (const task of tasks) {
      if (!task.done) await scheduleForTask(task, reminderMinutes);
    }
  }

  async function requestPermission() {
    if (isCapacitor && LocalNotifications) {
      const perm = await LocalNotifications.requestPermissions();
      return perm.display === 'granted';
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
    const remaining = [];

    for (const entry of scheduled) {
      const at = new Date(entry.at);
      if (at <= now && !isInQuietHours(at)) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(entry.title || '📋 AIVA', {
            body: entry.content,
            tag: `aiva-${entry.id}`,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            data: { task_id: entry.task_id },
            vibrate: [200, 100, 200],
            actions: [
              { action: 'open', title: 'Отвори' },
              { action: 'snooze', title: '⏰ +10 мин' },
              { action: 'done', title: 'Готово ✓' },
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
      if (mins < 60) return `закъснява ${mins} мин`;
      const hrs = Math.floor(mins / 60);
      return `закъснява ${hrs} ч`;
    }
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'сега';
    if (mins < 60) return `след ${mins} мин`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `след ${hrs}ч ${rem}мин` : `след ${hrs} ч`;
  }

  window.AIVA_NOTIFIER = {
    init,
    requestPermission,
    scheduleForTask,
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
