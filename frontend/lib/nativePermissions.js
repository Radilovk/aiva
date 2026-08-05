/**
 * APK: request all essential OS permissions on first launch (before user action).
 * Android still shows system dialogs — we cannot bypass them without root.
 */
(function () {
  const BOOT_KEY = 'aiva_permissions_boot_v2';

  function isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
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
      return await window.AIVA_NOTIFIER.ensureNativeReady();
    } catch {
      return false;
    }
  }

  async function requestBatteryExemption() {
    if (!window.AIVA_DEVICE?.isAndroid?.()) return false;
    try {
      const status = await window.AIVA_DEVICE.getStatus();
      if (status?.batteryOptimizationIgnored) return true;
      await window.AIVA_DEVICE.requestIgnoreBatteryOptimizations();
      return true;
    } catch {
      return false;
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
      await requestNotificationAccess();
      await requestCalendarAccess();
      await primeMicrophone();
      await requestBatteryExemption();
      await rescheduleNotifications();
      localStorage.setItem(BOOT_KEY, String(Date.now()));
    })();

    return bootstrap._promise;
  }

  window.AIVA_NATIVE_PERMISSIONS = {
    bootstrap,
    requestNotificationAccess,
    requestCalendarAccess,
    primeMicrophone,
  };

  function start() {
    if (!isNative()) return;
    // Defer to app.js after AIVA_NOTIFIER.init — avoid racing plugin registration.
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
