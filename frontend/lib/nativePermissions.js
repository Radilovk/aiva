/**
 * APK permissions: MainActivity batches mic + calendar + notifications on cold start.
 * This module activates notification channels and reschedules — no duplicate dialogs.
 */
(function () {
  const BOOT_KEY = 'aiva_permissions_boot_v3';
  const BATTERY_DEFER_MS = 4000;

  function isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function getLocalNotifications() {
    return window.Capacitor?.Plugins?.LocalNotifications ||
      window.Capacitor?.registerPlugin?.('LocalNotifications');
  }

  async function notificationGranted() {
    const LN = getLocalNotifications();
    if (!LN?.checkPermissions) return false;
    try {
      const perm = await LN.checkPermissions();
      return perm?.display === 'granted';
    } catch {
      return false;
    }
  }

  async function ensureNotificationsActive() {
    if (!window.AIVA_NOTIFIER) return false;
    if (await notificationGranted()) {
      return window.AIVA_NOTIFIER.ensureNativeReady({ request: false });
    }
    // MainActivity permission sheet may still be on screen on first frame.
    await new Promise((r) => setTimeout(r, 900));
    if (await notificationGranted()) {
      return window.AIVA_NOTIFIER.ensureNativeReady({ request: false });
    }
    return false;
  }

  async function requestBatteryExemptionIfNeeded() {
    if (!window.AIVA_DEVICE?.isAndroid?.()) return;
    const settings = window.AIVA_SETTINGS?.loadAssistantSettings?.();
    if (!settings?.notifications?.enabled) return;
    try {
      const status = await window.AIVA_DEVICE.getStatus();
      if (status?.batteryOptimizationIgnored) return;
      await window.AIVA_DEVICE.requestIgnoreBatteryOptimizations();
    } catch {
      /* optional OEM battery screen */
    }
  }

  async function rescheduleNotifications() {
    const settings = window.AIVA_SETTINGS?.loadAssistantSettings?.();
    if (!settings?.notifications?.enabled || !window.AIVA_NOTIFIER) return;
    const userId = localStorage.getItem('aiva_user_id');
    if (!userId) return;
    try {
      const apiBase = window.AIVA_CONFIG?.API_BASE || location.origin;
      const res = await fetch(`${apiBase}/api/tasks/${encodeURIComponent(userId)}`);
      const data = await res.json();
      await window.AIVA_NOTIFIER.scheduleAll(data.tasks || [], settings.notifications.reminderMinutes);
    } catch {
      /* best effort */
    }
  }

  async function bootstrap() {
    if (!isNative()) return;
    if (bootstrap._promise) return bootstrap._promise;

    bootstrap._promise = (async () => {
      await ensureNotificationsActive();
      await rescheduleNotifications();
      localStorage.setItem(BOOT_KEY, String(Date.now()));
      setTimeout(requestBatteryExemptionIfNeeded, BATTERY_DEFER_MS);
    })();

    return bootstrap._promise;
  }

  async function primeMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      return true;
    } catch {
      return false;
    }
  }

  async function requestCalendarAccess() {
    if (!window.AIVA_CALENDAR_CRUD?.isAndroid?.()) return false;
    try {
      const result = await window.AIVA_CALENDAR_CRUD.requestPermissions();
      return !!result?.granted;
    } catch {
      return false;
    }
  }

  async function requestNotificationAccess() {
    if (!window.AIVA_NOTIFIER) return false;
    try {
      return await window.AIVA_NOTIFIER.ensureNativeReady({ request: true });
    } catch {
      return false;
    }
  }

  window.AIVA_NATIVE_PERMISSIONS = {
    bootstrap,
    requestNotificationAccess,
    requestCalendarAccess,
    primeMicrophone,
  };

  function start() {
    if (!isNative()) return;
    if (window.AIVA_NOTIFIER) {
      bootstrap();
    } else {
      window.addEventListener('aiva:notifier-ready', () => bootstrap(), { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
