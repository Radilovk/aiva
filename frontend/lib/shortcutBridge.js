/**
 * Android hardware shortcut bridge — volume button patterns to start listening.
 */
(function () {
  const PLUGIN_NAME = 'AivaShortcut';

  function getPlugin() {
    return window.Capacitor?.Plugins?.[PLUGIN_NAME] || null;
  }

  function isAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  async function applyShortcutConfig(config) {
    const plugin = getPlugin();
    if (!plugin?.configure) return { ok: false, reason: 'unavailable' };

    // Тригерът е фиксиран: двата бутона за звук (+ и −) натиснати едновременно
    await plugin.configure({ enabled: !!config.enabled });
    return { ok: true };
  }

  async function openAccessibilitySettings() {
    const plugin = getPlugin();
    if (plugin?.openAccessibilitySettings) {
      await plugin.openAccessibilitySettings();
    }
  }

  async function isAccessibilityEnabled() {
    const plugin = getPlugin();
    if (!plugin?.isAccessibilityEnabled) return false;
    const result = await plugin.isAccessibilityEnabled();
    return !!result?.enabled;
  }

  function onShortcutTriggered(callback) {
    const plugin = getPlugin();
    if (!plugin?.addListener) return () => {};

    const handle = plugin.addListener('shortcutTriggered', () => {
      window.dispatchEvent(new CustomEvent('aiva:shortcut-triggered'));
      callback?.();
    });

    return () => handle.remove?.();
  }

  function consumePendingLaunch() {
    const plugin = getPlugin();
    if (!plugin?.getPendingLaunch) return Promise.resolve(false);
    return plugin.getPendingLaunch().then((r) => !!r?.pending).catch(() => false);
  }

  function clearPendingLaunch() {
    const plugin = getPlugin();
    if (plugin?.clearPendingLaunch) {
      return plugin.clearPendingLaunch().catch(() => {});
    }
    return Promise.resolve();
  }

  window.AIVA_SHORTCUT = {
    isAndroid,
    applyShortcutConfig,
    openAccessibilitySettings,
    isAccessibilityEnabled,
    onShortcutTriggered,
    consumePendingLaunch,
    clearPendingLaunch,
  };
})();
