/**
 * Device profile — detects the phone maker once at first run ("installation")
 * and adapts the app to that phone: OEM battery/autostart guidance so
 * reminders and the volume shortcut keep working when the app is closed.
 */
(function () {
  const CACHE_SUFFIX = 'device_profile_v1';

  function readCache() {
    return window.KASY_STORAGE?.get?.(CACHE_SUFFIX)
      || localStorage.getItem(`kasy_${CACHE_SUFFIX}`)
      || localStorage.getItem(`aiva_${CACHE_SUFFIX}`);
  }

  function writeCache(value) {
    if (window.KASY_STORAGE?.set) window.KASY_STORAGE.set(CACHE_SUFFIX, value);
    else localStorage.setItem(`kasy_${CACHE_SUFFIX}`, value);
  }

  function getPlugin() {
    return window.Capacitor?.Plugins?.AivaDevice || null;
  }

  function isAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  async function fetchProfile() {
    const plugin = getPlugin();
    if (!plugin?.getDeviceProfile) return null;
    try {
      const profile = await plugin.getDeviceProfile();
      if (profile?.profile) writeCache(JSON.stringify(profile));
      return profile;
    } catch (_e) {
      return null;
    }
  }

  /** Cached identity — detected once at first run, then reused instantly. */
  async function detect() {
    if (!isAndroid()) return null;
    try {
      const cached = JSON.parse(readCache() || 'null');
      if (cached?.profile) return cached;
    } catch (_e) { /* повреден кеш — засичаме наново */ }
    return fetchProfile();
  }

  /** Fresh status — battery-optimization state can change at any time. */
  async function getStatus() {
    if (!isAndroid()) return null;
    return (await fetchProfile()) || detect();
  }

  async function requestIgnoreBatteryOptimizations() {
    const plugin = getPlugin();
    if (!plugin?.requestIgnoreBatteryOptimizations) return { requested: false };
    return plugin.requestIgnoreBatteryOptimizations();
  }

  async function openAutostartSettings() {
    const plugin = getPlugin();
    if (!plugin?.openAutostartSettings) return { opened: 'none' };
    return plugin.openAutostartSettings();
  }

  window.AIVA_DEVICE = {
    isAndroid,
    detect,
    getStatus,
    requestIgnoreBatteryOptimizations,
    openAutostartSettings,
  };
})();
