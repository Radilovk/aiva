/**
 * Quiet device intelligence — probes phone model, OS, permissions and AI control hints
 * on first APK launch without UI. Cached locally for voice session context.
 */
(function () {
  const CACHE_KEY = 'aiva_device_intel_v1';
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;

  function isAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  function getPlugin() {
    return window.Capacitor?.Plugins?.AivaDevice || null;
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function writeCache(intel) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(intel));
  }

  function isStale(intel) {
    if (!intel?.probedAt) return true;
    return Date.now() - new Date(intel.probedAt).getTime() > STALE_MS;
  }

  async function probe(force = false) {
    const cached = readCache();
    if (cached && !force && !isStale(cached)) return cached;

    const plugin = getPlugin();
    let data = null;

    if (plugin?.getDeviceCapabilities) {
      try {
        data = await plugin.getDeviceCapabilities();
      } catch {
        /* fallback */
      }
    }
    if (!data && plugin?.getDeviceProfile) {
      try {
        data = await plugin.getDeviceProfile();
      } catch {
        /* ignore */
      }
    }
    if (!data && window.AIVA_DEVICE?.getStatus) {
      data = await window.AIVA_DEVICE.getStatus();
    }

    if (!data) return cached;

    const intel = { ...data, probedAt: new Date().toISOString(), source: 'quiet_probe' };
    writeCache(intel);
    return intel;
  }

  /** Silent bootstrap — no UI, runs once per install or when stale. */
  async function bootstrapQuiet() {
    if (!isAndroid()) return null;
    return probe(false);
  }

  function formatForPrompt(intel) {
    if (!intel) return '';
    const lines = [
      'ИНТЕЛИГЕНЦИЯ УСТРОЙСТВО (за device actions — адаптирай се към този телефон):',
      `- ${intel.manufacturer || '?'} ${intel.model || ''} · Android ${intel.androidVersion || '?'} · OEM ${intel.profile || 'stock'}`,
    ];

    if (intel.installedApps) {
      const apps = [];
      if (intel.installedApps.googleMaps) apps.push('Google Maps');
      if (intel.installedApps.petalMaps) apps.push('Petal Maps');
      if (intel.installedApps.waze) apps.push('Waze');
      if (intel.installedApps.viber) apps.push('Viber');
      if (intel.installedApps.whatsapp) apps.push('WhatsApp');
      if (apps.length) lines.push(`- Инсталирани: ${apps.join(', ')}`);
    }

    if (intel.permissions) {
      const missing = Object.entries(intel.permissions)
        .filter(([, v]) => v === false)
        .map(([k]) => k);
      if (missing.length) lines.push(`- Липсващи разрешения: ${missing.join(', ')}`);
    }

    const hints = intel.aiControlHints;
    if (Array.isArray(hints) && hints.length) {
      lines.push('- AI контрол:');
      for (const h of hints.slice(0, 4)) lines.push(`  • ${h}`);
    }

    if (intel.dontKillMyAppUrl) {
      lines.push(`- OEM фон: ${intel.dontKillMyAppUrl}`);
    }

    return lines.join('\n');
  }

  window.AIVA_DEVICE_INTEL = {
    probe,
    bootstrapQuiet,
    readCache,
    formatForPrompt,
  };
})();
