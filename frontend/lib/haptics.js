(function () {
  const PAUSE_MS = 90;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function vibrateOnce(duration = 28) {
    const Haptics = window.Capacitor?.Plugins?.Haptics;
    if (Haptics?.impact) {
      try {
        await Haptics.impact({ style: 'Light' });
        return;
      } catch {
        // fall through to navigator.vibrate
      }
    }
    if (navigator.vibrate) {
      navigator.vibrate(duration);
    }
  }

  async function onListeningStart() {
    await vibrateOnce();
    await sleep(PAUSE_MS);
    await vibrateOnce();
  }

  async function onListeningStop() {
    await vibrateOnce();
  }

  window.AIVA_HAPTICS = {
    onListeningStart,
    onListeningStop,
  };
})();
