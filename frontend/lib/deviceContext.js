/**
 * Device context — collected once (or when stale), cached locally, injected every session.
 */
(function () {
  const CACHE_KEY = 'aiva_device_context_v2';
  const STALE_MS = 7 * 24 * 60 * 60 * 1000;

  function getPlugin() {
    return window.Capacitor?.Plugins?.AivaDevice || null;
  }

  function isAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  function webFallback() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    return {
      platform: window.Capacitor?.getPlatform?.() || 'web',
      manufacturer: 'browser',
      brand: 'browser',
      model: navigator.userAgent?.slice(0, 120) || 'unknown',
      timezone: tz,
      locale: navigator.language || 'unknown',
      profile: 'web',
      collectedAt: new Date().toISOString(),
    };
  }

  async function fetchNativeProfile() {
    const intel = await window.AIVA_DEVICE_INTEL?.probe?.(false);
    if (intel) return { ...intel, platform: 'android', collectedAt: intel.probedAt || new Date().toISOString() };

    const plugin = getPlugin();
    if (!plugin?.getDeviceProfile) return null;
    try {
      const profile = await plugin.getDeviceProfile();
      return profile ? { ...profile, platform: 'android', collectedAt: new Date().toISOString() } : null;
    } catch (_e) {
      return null;
    }
  }

  function readCache() {
    try {
      return JSON.parse(window.localStorage?.getItem?.(CACHE_KEY) || 'null');
    } catch (_e) {
      return null;
    }
  }

  function writeCache(ctx) {
    window.localStorage?.setItem?.(CACHE_KEY, JSON.stringify(ctx));
  }

  function isStale(ctx) {
    if (!ctx?.collectedAt) return true;
    return Date.now() - new Date(ctx.collectedAt).getTime() > STALE_MS;
  }

  async function collect(force = false) {
    const cached = readCache();
    if (cached && !force && !isStale(cached)) return cached;

    let ctx = null;
    if (isAndroid()) {
      ctx = await fetchNativeProfile();
    }
    if (!ctx) ctx = webFallback();
    writeCache(ctx);
    return ctx;
  }

  function formatForPrompt(ctx) {
    if (!ctx) return '';
    const intelBlock = window.AIVA_DEVICE_INTEL?.formatForPrompt?.(window.AIVA_DEVICE_INTEL.readCache?.());
    const lines = [
      'УСТРОЙСТВО (постоянен контекст — използвай за device actions и OEM поведение):',
      `- Платформа: ${ctx.platform || 'unknown'}`,
      `- Производител/марка: ${ctx.manufacturer || '?'} / ${ctx.brand || '?'}`,
      `- Модел: ${ctx.model || '?'}`,
    ];
    if (ctx.device) lines.push(`- Код устройство: ${ctx.device}`);
    if (ctx.androidVersion) lines.push(`- Android: ${ctx.androidVersion} (SDK ${ctx.sdkInt || '?'})`);
    if (ctx.profile) lines.push(`- OEM профил: ${ctx.profile}`);
    if (ctx.timezone) lines.push(`- Часова зона: ${ctx.timezone}`);
    if (ctx.needsAutostart) lines.push('- Нужен autostart/battery exemption за фонови напомняния');
    if (ctx.batteryOptimizationIgnored === false) lines.push('- Battery optimization НЕ е изключена');
    if (intelBlock) lines.push('', intelBlock);
    return lines.join('\n');
  }

  async function ensureMemorySeed() {
    const ctx = await collect();
    if (!ctx || !window.AIVA_MEMORY?.upsertEntry) return;
    const summary = [
      ctx.manufacturer,
      ctx.brand,
      ctx.model,
      ctx.androidVersion ? `Android ${ctx.androidVersion}` : null,
      ctx.profile ? `OEM ${ctx.profile}` : null,
      ctx.timezone,
    ].filter(Boolean).join(', ');
    await window.AIVA_MEMORY.upsertEntry({
      key: 'device',
      category: 'device',
      content: summary || 'Unknown device',
      source: 'system',
    });
  }

  async function setVoiceSessionActive(active) {
    const plugin = getPlugin();
    if (!plugin?.setVoiceSessionActive) return { ok: false };
    try {
      return await plugin.setVoiceSessionActive({ active: !!active });
    } catch (_e) {
      return { ok: false };
    }
  }

  window.AIVA_DEVICE_CONTEXT = {
    collect,
    readCache,
    formatForPrompt,
    ensureMemorySeed,
    setVoiceSessionActive,
  };
})();
