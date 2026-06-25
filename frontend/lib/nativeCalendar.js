/**
 * Platform-aware native calendar integration for iOS, Android (APK) and web.
 *
 * Strategy:
 *   Android APK  → AivaCalendar Capacitor plugin (CalendarContract) when available
 *   iOS / mobile → ICS share sheet + webcal subscribe
 *   Web          → Google Calendar deep link + ICS download
 */
(function () {
  const SYNC_MAP_KEY = 'aiva_native_calendar_map';

  function isNative() {
    return !!window.Capacitor?.isNativePlatform?.();
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function getPlatform() {
    if (isNative() && isAndroid()) return 'android-native';
    if (isNative() && isIOS()) return 'ios-native';
    if (isIOS()) return 'ios-web';
    if (isAndroid()) return 'android-web';
    return 'web';
  }

  function getReminderOptions() {
    const settings = window.AIVA_SETTINGS?.loadAssistantSettings?.() || {};
    return {
      reminderMinutes: settings.notifications?.reminderMinutes ?? 15,
      remindAtStart: settings.notifications?.remindAtStart !== false,
    };
  }

  function loadSyncMap() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_MAP_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveSyncMap(map) {
    localStorage.setItem(SYNC_MAP_KEY, JSON.stringify(map));
  }

  function getNativePlugin() {
    if (!isNative()) return null;
    try {
      return window.Capacitor?.Plugins?.AivaCalendar ||
        window.Capacitor?.registerPlugin?.('AivaCalendar');
    } catch {
      return null;
    }
  }

  async function requestNativePermissions() {
    const plugin = getNativePlugin();
    if (!plugin?.requestPermissions) return { granted: false };
    try {
      const result = await plugin.requestPermissions();
      return { granted: result?.calendar === 'granted' || result?.writeCalendar === 'granted' };
    } catch (e) {
      console.warn('Native calendar permissions:', e);
      return { granted: false };
    }
  }

  async function addViaNativePlugin(task) {
    const plugin = getNativePlugin();
    if (!plugin?.addEvent) return null;

    const parsed = window.AIVA_ICS?.parseTaskDateTime(task);
    if (!parsed) throw new Error(window.AIVA_I18N?.t?.('errNoDate') || 'Task has no date');

    const opts = getReminderOptions();
    const result = await plugin.addEvent({
      title: task.content,
      description: task.notes || '',
      location: task.location || '',
      startTime: parsed.start.getTime(),
      endTime: parsed.end.getTime(),
      reminderMinutes: opts.reminderMinutes,
      remindAtStart: opts.remindAtStart,
      taskId: task.id,
    });

    if (result?.eventId && task.id) {
      const map = loadSyncMap();
      map[String(task.id)] = { eventId: result.eventId, platform: 'android-native', syncedAt: Date.now() };
      saveSyncMap(map);
    }

    return result;
  }

  async function updateViaNativePlugin(task) {
    const plugin = getNativePlugin();
    if (!plugin?.updateEvent || !task?.id) return null;

    const map = loadSyncMap();
    const entry = map[String(task.id)];
    if (!entry?.eventId) return null;

    const parsed = window.AIVA_ICS?.parseTaskDateTime(task);
    if (!parsed) return null;

    const opts = getReminderOptions();
    return plugin.updateEvent({
      eventId: entry.eventId,
      title: task.content,
      description: task.notes || '',
      location: task.location || '',
      startTime: parsed.start.getTime(),
      endTime: parsed.end.getTime(),
      reminderMinutes: opts.reminderMinutes,
      remindAtStart: opts.remindAtStart,
      taskId: task.id,
    });
  }

  async function removeViaNativePlugin(taskId) {
    const plugin = getNativePlugin();
    if (!plugin?.removeEvent || !taskId) return null;

    const map = loadSyncMap();
    const entry = map[String(taskId)];
    if (!entry?.eventId) return null;

    try {
      await plugin.removeEvent({ eventId: entry.eventId, taskId });
    } finally {
      delete map[String(taskId)];
      saveSyncMap(map);
    }
  }

  async function shareICS(task) {
    if (!window.AIVA_CALENDAR?.addToDevice) {
      throw new Error('ICS модулът не е зареден');
    }
    return window.AIVA_CALENDAR.addToDevice(task);
  }

  async function openGoogleCalendar(task) {
    const url = window.AIVA_ICS?.getGoogleCalendarUrl(task);
    if (!url) throw new Error(window.AIVA_I18N?.t?.('errNoDate') || 'Task has no date');
    window.open(url, '_blank', 'noopener,noreferrer');
    return 'google';
  }

  /**
   * Smart add: tries native plugin on Android APK, then ICS share, then Google link.
   */
  async function addToDeviceCalendar(task, options = {}) {
    if (!task?.due_date) {
      throw new Error(window.AIVA_I18N?.t?.('errNoDateAdd') || 'Task has no date — cannot add to calendar');
    }

    const platform = getPlatform();
    const preferNative = options.preferNative !== false;

    // Android APK: try native CalendarContract first
    if (preferNative && platform === 'android-native') {
      try {
        const perms = await requestNativePermissions();
        if (perms.granted) {
          const result = await addViaNativePlugin(task);
          if (result) return { method: 'native', platform, ...result };
        }
      } catch (e) {
        console.warn('Native calendar insert failed, falling back to ICS:', e);
      }
    }

    // iOS / all platforms: ICS share sheet (opens Apple Calendar, Google Calendar, etc.)
    if (platform.startsWith('ios') || options.preferShare) {
      const result = await shareICS(task);
      return { method: 'ics-share', platform, result };
    }

    // Android web/APK fallback: try share first
    if (navigator.canShare) {
      try {
        const result = await shareICS(task);
        if (result !== 'aborted') return { method: 'ics-share', platform, result };
      } catch (e) {
        if (e?.name === 'AbortError') return { method: 'aborted', platform };
      }
    }

    // Web fallback: Google Calendar deep link
    if (options.allowGoogle !== false) {
      return { method: 'google', platform, result: await openGoogleCalendar(task) };
    }

    const result = await shareICS(task);
    return { method: 'ics-download', platform, result };
  }

  async function syncTaskToDevice(task) {
    if (!task?.due_date) return { action: 'skip' };

    const map = loadSyncMap();
    if (map[String(task.id)]?.eventId && getNativePlugin()?.updateEvent) {
      try {
        await updateViaNativePlugin(task);
        return { action: 'updated', method: 'native' };
      } catch (e) {
        console.warn('Native calendar update failed:', e);
      }
    }

    return addToDeviceCalendar(task);
  }

  async function removeFromDeviceCalendar(taskId) {
    if (getNativePlugin()?.removeEvent) {
      try {
        await removeViaNativePlugin(taskId);
        return { action: 'removed', method: 'native' };
      } catch (e) {
        console.warn('Native calendar remove failed:', e);
      }
    }
    const map = loadSyncMap();
    delete map[String(taskId)];
    saveSyncMap(map);
    return { action: 'map-cleared' };
  }

  function isTaskSynced(taskId) {
    return !!loadSyncMap()[String(taskId)];
  }

  function getPlatformLabel() {
    const labels = {
      'android-native': 'Android календар',
      'ios-native': 'Apple Calendar',
      'ios-web': 'Apple Calendar',
      'android-web': 'Google Calendar',
      web: 'календар',
    };
    return labels[getPlatform()] || 'календар';
  }

  window.AIVA_NATIVE_CALENDAR = {
    isNative,
    isIOS,
    isAndroid,
    getPlatform,
    getPlatformLabel,
    requestNativePermissions,
    addToDeviceCalendar,
    syncTaskToDevice,
    removeFromDeviceCalendar,
    openGoogleCalendar,
    isTaskSynced,
    loadSyncMap,
  };
})();
