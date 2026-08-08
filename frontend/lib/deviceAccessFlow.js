/**
 * Unified device & app access — automated OS permission flow per phone/OEM.
 */
(function () {
  const STEP_DELAY_MS = 700;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  function tf(key, vars) {
    return window.AIVA_I18N?.tf?.(key, vars) ?? key;
  }

  function t(key) {
    return window.AIVA_I18N?.t?.(key) ?? key;
  }

  async function getProfile() {
    if (!window.AIVA_DEVICE?.isAndroid?.()) return null;
    try {
      return await window.AIVA_DEVICE.getStatus();
    } catch {
      return null;
    }
  }

  function oemKey(profile) {
    const p = String(profile?.profile || profile?.oem || '').toLowerCase();
    if (p) return p;
    const m = `${profile?.manufacturer || ''} ${profile?.brand || ''}`.toLowerCase();
    if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) return 'xiaomi';
    if (m.includes('huawei') || m.includes('honor')) return 'huawei';
    if (m.includes('samsung')) return 'samsung';
    if (m.includes('oppo') || m.includes('realme')) return 'oppo';
    if (m.includes('vivo') || m.includes('iqoo')) return 'vivo';
    return 'stock';
  }

  function buildInfoHtml(profile) {
    const brand = profile?.manufacturer || profile?.brand || 'Android';
    const model = profile?.model || '';
    const version = profile?.androidVersion || '';
    const oem = oemKey(profile);

    const lines = [
      t('deviceAccessInfoIntro'),
      '',
      t('deviceAccessInfoCapabilities'),
    ];

    if (oem === 'xiaomi') {
      lines.push('', t('deviceAccessInfoOemXiaomi'));
    } else if (oem === 'huawei') {
      lines.push('', t('deviceAccessInfoOemHuawei'));
    } else if (oem === 'samsung') {
      lines.push('', t('deviceAccessInfoOemSamsung'));
    } else {
      lines.push('', tf('deviceAccessInfoOemGeneric', { brand }));
    }

    if (profile?.needsAutostart) {
      lines.push('', tf('deviceAccessInfoAutostart', { brand }));
    }

    lines.push('', tf('deviceAccessInfoDetected', { brand, model, version }));

    return lines.join('\n');
  }

  async function grantAll() {
    if (!isAndroid()) {
      return { ok: true, platform: 'web' };
    }

    const profile = await getProfile();
    const results = {};

    if (window.AIVA_NATIVE_PERMISSIONS?.primeMicrophone) {
      results.microphone = await window.AIVA_NATIVE_PERMISSIONS.primeMicrophone();
      await sleep(STEP_DELAY_MS);
    }

    if (window.AIVA_NATIVE_PERMISSIONS?.requestNotificationAccess) {
      results.notifications = await window.AIVA_NATIVE_PERMISSIONS.requestNotificationAccess();
      await sleep(STEP_DELAY_MS);
    }

    if (window.AIVA_NATIVE_PERMISSIONS?.requestCalendarAccess) {
      results.calendar = await window.AIVA_NATIVE_PERMISSIONS.requestCalendarAccess();
      await sleep(STEP_DELAY_MS);
    }

    if (window.AIVA_DEVICE_ACTIONS?.requestContactsPermission) {
      results.contacts = await window.AIVA_DEVICE_ACTIONS.requestContactsPermission();
      await sleep(STEP_DELAY_MS);
    }

    if (window.AIVA_DEVICE?.requestIgnoreBatteryOptimizations) {
      const status = profile || await getProfile();
      if (!status?.batteryOptimizationIgnored) {
        await window.AIVA_DEVICE.requestIgnoreBatteryOptimizations();
        results.battery = true;
        await sleep(STEP_DELAY_MS);
      } else {
        results.battery = true;
      }
    }

    if (profile?.needsAutostart && window.AIVA_DEVICE?.openAutostartSettings) {
      await window.AIVA_DEVICE.openAutostartSettings();
      results.autostart = true;
    }

    return { ok: true, results, profile };
  }

  async function getAccessSummary() {
    if (!isAndroid()) return { platform: 'web' };

    const profile = await getProfile();
    const summary = {
      microphone: false,
      notifications: false,
      calendar: false,
      contacts: false,
      battery: !!profile?.batteryOptimizationIgnored,
      autostart: !profile?.needsAutostart,
    };

    try {
      const LN = window.Capacitor?.Plugins?.LocalNotifications;
      if (LN?.checkPermissions) {
        const p = await LN.checkPermissions();
        summary.notifications = p?.display === 'granted';
      }
    } catch { /* ignore */ }

    if (window.AIVA_CALENDAR_CRUD?.isAndroid?.()) {
      try {
        const cal = window.Capacitor?.Plugins?.AivaCalendar;
        if (cal?.checkPermissions) {
          const p = await cal.checkPermissions();
          summary.calendar = p?.calendar === 'granted';
        }
      } catch { /* ignore */ }
    }

    if (window.AIVA_DEVICE_ACTIONS?.hasContactsPermission) {
      summary.contacts = await window.AIVA_DEVICE_ACTIONS.hasContactsPermission();
    }

    return { profile, summary };
  }

  window.AIVA_DEVICE_ACCESS = {
    isAndroid,
    getProfile,
    buildInfoHtml,
    grantAll,
    getAccessSummary,
    oemKey,
  };
})();
