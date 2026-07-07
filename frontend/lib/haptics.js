(function () {
  const PAUSE_MS = 90;
  let audioCtx = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioCtx = new AudioContextCtor();
    }
    return audioCtx;
  }

  async function playTone(frequency, durationSec, volume = 0.12) {
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(volume, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationSec);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + durationSec);
    } catch {
      // Audio feedback is best-effort only.
    }
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
    await Promise.all([playTone(880, 0.07), vibrateOnce()]);
    await sleep(PAUSE_MS);
    await Promise.all([playTone(1175, 0.09), vibrateOnce()]);
  }

  async function onListeningStop() {
    await Promise.all([playTone(620, 0.11), vibrateOnce()]);
  }

  window.AIVA_HAPTICS = {
    onListeningStart,
    onListeningStop,
  };
})();
