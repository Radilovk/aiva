/**
 * AIVA Local Notification Scheduler
 * Works with Capacitor LocalNotifications plugin in APK mode,
 * falls back to Service Worker notifications in PWA mode.
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

  let isCapacitor = false;
  let LocalNotifications = null;

  async function init() {
    // Detect Capacitor environment
    if (window.Capacitor?.isNativePlatform?.()) {
      try {
        LocalNotifications = window.Capacitor.registerPlugin('LocalNotifications');
        await LocalNotifications.requestPermissions();
        await LocalNotifications.createChannel(NOTIFICATION_CHANNEL);
        isCapacitor = true;
        console.log('🔔 Capacitor notifications ready');
      } catch (e) {
        console.warn('Capacitor notifications unavailable:', e);
      }
    }

    // PWA fallback — request permission
    if (!isCapacitor && 'Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    }
  }

  async function scheduleForTask(task, reminderMinutes) {
    if (!task.due_date || !task.due_time) return;

    const [year, month, day] = task.due_date.split('-').map(Number);
    const [hours, minutes] = task.due_time.split(':').map(Number);
    const taskDate = new Date(year, month - 1, day, hours, minutes);
    const notifyAt = new Date(taskDate.getTime() - (reminderMinutes || 15) * 60000);

    if (notifyAt <= new Date()) return; // Past — skip

    const notifId = Math.abs(task.id) % 2147483647; // Safe int32

    if (isCapacitor && LocalNotifications) {
      await LocalNotifications.schedule({
        notifications: [{
          id: notifId,
          title: '📋 AIVA',
          body: task.content,
          schedule: { at: notifyAt },
          channelId: NOTIFICATION_CHANNEL.id,
          actionTypeId: 'aiva_task_reminder',
          extra: { task_id: task.id },
          actions: [
            { id: 'open', title: 'Отвори' },
            { id: 'done', title: 'Готово ✓' },
          ],
        }],
      });
    } else if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      // Store scheduled notification for SW to handle
      const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
      scheduled.push({ id: notifId, task_id: task.id, content: task.content, at: notifyAt.toISOString() });
      localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(scheduled));
    }
  }

  async function cancelForTask(taskId) {
    const notifId = Math.abs(taskId) % 2147483647;
    if (isCapacitor && LocalNotifications) {
      await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
    }
    // Clean from SW scheduled list
    const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
    const filtered = scheduled.filter((n) => n.task_id !== taskId);
    localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(filtered));
  }

  async function scheduleAll(tasks, reminderMinutes) {
    for (const task of tasks) {
      await scheduleForTask(task, reminderMinutes);
    }
  }

  // Check & fire SW-based scheduled notifications
  function checkScheduledNotifications() {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;

    const scheduled = JSON.parse(localStorage.getItem('aiva_scheduled_notifs') || '[]');
    const now = new Date();
    const remaining = [];

    for (const entry of scheduled) {
      if (new Date(entry.at) <= now) {
        new Notification('📋 AIVA', { body: entry.content, tag: `aiva-${entry.id}` });
      } else {
        remaining.push(entry);
      }
    }

    localStorage.setItem('aiva_scheduled_notifs', JSON.stringify(remaining));
  }

  // Poll every 30s for SW-based notifications
  setInterval(checkScheduledNotifications, 30000);

  window.AIVA_NOTIFIER = {
    init,
    scheduleForTask,
    cancelForTask,
    scheduleAll,
  };
})();
