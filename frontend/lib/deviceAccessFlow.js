/**
 * Unified device & app access — OEM-adaptive automated permission flow.
 * Uses quiet device intelligence for step ordering per manufacturer.
 */
(function () {
  const STEP_DELAY_MS = 900;

  const OEM_GRANT_STEPS = {
    xiaomi: ['microphone', 'notifications', 'battery', 'autostart', 'calendar', 'contacts'],
    huawei: ['microphone', 'notifications', 'battery', 'autostart', 'calendar', 'contacts'],
    samsung: ['microphone', 'notifications', 'calendar', 'contacts', 'battery'],
    oppo: ['microphone', 'notifications', 'battery', 'autostart', 'calendar', 'contacts'],
    vivo: ['microphone', 'notifications', 'battery', 'autostart', 'calendar', 'contacts'],
    oneplus: ['microphone', 'notifications', 'battery', 'autostart', 'calendar', 'contacts'],
    stock: ['microphone', 'notifications', 'calendar', 'contacts', 'battery'],
  };

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
    const intel = window.AIVA_DEVICE_INTEL?.readCache?.();
    if (intel?.profile) return intel;
    if (!window.AIVA_DEVICE?.isAndroid?.()) return null;
    try {
      return await window.AIVA_DEVICE.getStatus();
    } catch {
      return null;
    }
  }

  function oemKey(profile) {
    const p = String(profile?.profile || profile?.oem || '').toLowerCase();
    if (p && OEM_GRANT_STEPS[p]) return p;
    const m = `${profile?.manufacturer || ''} ${profile?.brand || ''}`.toLowerCase();
    if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) return 'xiaomi';
    if (m.includes('huawei') || m.includes('honor')) return 'huawei';
    if (m.includes('samsung')) return 'samsung';
    if (m.includes('oppo') || m.includes('realme')) return 'oppo';
    if (m.includes('vivo') || m.includes('iqoo')) return 'vivo';
    if (m.includes('oneplus')) return 'oneplus';
    return 'stock';
  }

  function buildInfoHtml(profile) {
    const brand = profile?.manufacturer || profile?.brand || 'Android';
    const model = profile?.model || '';
    const version = profile?.androidVersion || '';
    const oem = oemKey(profile);

    const lines = [t('deviceAccessInfoIntro'), '', t('deviceAccessInfoCapabilities')];

    if (oem === 'xiaomi') lines.push('', t('deviceAccessInfoOemXiaomi'));
    else if (oem === 'huawei') lines.push('', t('deviceAccessInfoOemHuawei'));
    else if (oem === 'samsung') lines.push('', t('deviceAccessInfoOemSamsung'));
    else lines.push('', tf('deviceAccessInfoOemGeneric', { brand }));

    if (profile?.needsAutostart) {
      lines.push('', tf('deviceAccessInfoAutostart', { brand }));
    }

    const hints = profile?.aiControlHints;
    if (Array.isArray(hints) && hints.length) {
      lines.push('', t('deviceAccessInfoAiHints'));
      for (const h of hints.slice(0, 3)) lines.push(`• ${h}`);
    }

    lines.push('', tf('deviceAccessInfoDetected', { brand, model, version }));
    if (profile?.dontKillMyAppUrl) {
      lines.push('', tf('deviceAccessInfoDontKill', { url: profile.dontKillMyAppUrl }));
    }

    return lines.join('\n');
  }

  async function runStep(step, profile, results) {
    switch (step) {
      case 'microphone':
        if (window.AIVA_NATIVE_PERMISSIONS?.primeMicrophone) {
          results.microphone = await window.AIVA_NATIVE_PERMISSIONS.primeMicrophone();
        }
        break;
      case 'notifications':
        if (window.AIVA_NATIVE_PERMISSIONS?.requestNotificationAccess) {
          results.notifications = await window.AIVA_NATIVE_PERMISSIONS.requestNotificationAccess();
        }
        break;
      case 'calendar':
        if (window.AIVA_NATIVE_PERMISSIONS?.requestCalendarAccess) {
          results.calendar = await window.AIVA_NATIVE_PERMISSIONS.requestCalendarAccess();
        }
        break;
      case 'contacts':
        if (window.AIVA_DEVICE_ACTIONS?.requestContactsPermission) {
          results.contacts = await window.AIVA_DEVICE_ACTIONS.requestContactsPermission();
        }
        break;
      case 'battery':
        if (window.AIVA_DEVICE?.requestIgnoreBatteryOptimizations) {
          const fresh = profile || (await getProfile());
          if (!fresh?.batteryOptimizationIgnored) {
            await window.AIVA_DEVICE.requestIgnoreBatteryOptimizations();
          }
          results.battery = true;
        }
        break;
      case 'autostart':
        if (profile?.needsAutostart && window.AIVA_DEVICE?.openAutostartSettings) {
          await window.AIVA_DEVICE.openAutostartSettings();
          results.autostart = true;
        }
        break;
      default:
        break;
    }
    await sleep(STEP_DELAY_MS);
  }

  async function grantAll() {
    if (!isAndroid()) return { ok: true, platform: 'web' };

    await window.AIVA_DEVICE_INTEL?.probe?.(true);
    const profile = await getProfile();
    const oem = oemKey(profile);
    const steps = OEM_GRANT_STEPS[oem] || OEM_GRANT_STEPS.stock;
    const results = {};

    for (const step of steps) {
      await runStep(step, profile, results);
    }

    await window.AIVA_DEVICE_INTEL?.probe?.(true);
    return { ok: true, results, profile, oem, steps };
  }

  async function getAccessSummary() {
    if (!isAndroid()) return { platform: 'web' };

    const intel = await window.AIVA_DEVICE_INTEL?.probe?.(false);
    const profile = intel || (await getProfile());
    const perms = intel?.permissions || {};

    const summary = {
      microphone: !!perms.microphone,
      notifications: !!perms.notifications,
      calendar: !!(perms.calendarRead && perms.calendarWrite),
      contacts: !!perms.contacts,
      battery: !!profile?.batteryOptimizationIgnored,
      autostart: !profile?.needsAutostart,
    };

    if (summary.notifications === false) {
      try {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN?.checkPermissions) {
          const p = await LN.checkPermissions();
          summary.notifications = p?.display === 'granted';
        }
      } catch { /* ignore */ }
    }

    if (summary.calendar === false) {
      try {
        const cal = window.Capacitor?.Plugins?.AivaCalendar;
        if (cal?.checkPermissions) {
          const p = await cal.checkPermissions();
          summary.calendar = p?.calendar === 'granted';
        }
      } catch { /* ignore */ }
    }

    if (summary.contacts === false && window.AIVA_DEVICE_ACTIONS?.hasContactsPermission) {
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
