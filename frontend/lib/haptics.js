(function () {
  const PAUSE_MS = 90;
  const SPEECH_SAMPLE_RATE = 24000;
  const FRAME_SAMPLES = 480; // 20 ms @ 24 kHz
  const MIN_PULSE_GAP_MS = 18;
  const SILENCE_RMS = 0.014;
  const VOWEL_RMS = 0.03;
  const CONSONANT_ZCR = 0.1;
  const IDLE_END_MS = 600;

  function isPlaybackScheduled() {
    const endMs = window.__aivaAudioPlayer?.getScheduledPlaybackEndMs?.();
    return typeof endMs === 'number' && endMs > performance.now() + 40;
  }

  let audioCtx = null;
  let speechEnabled = true;
  let speechSessionActive = false;
  let speechPending = new Float32Array(0);
  let lastFeedAt = 0;
  let lastPulseAt = 0;
  let vibrateChain = Promise.resolve();
  let sustainTimer = null;

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

  function getCapacitorHaptics() {
    return window.Capacitor?.Plugins?.Haptics;
  }

  async function vibrateOnce(duration = 28) {
    const ms = Math.max(8, Math.min(220, duration));
    const Haptics = getCapacitorHaptics();
    if (Haptics?.vibrate) {
      try {
        await Haptics.vibrate({ duration: ms });
        return;
      } catch {
        // fall through
      }
    }
    if (Haptics?.impact) {
      try {
        await Haptics.impact({ style: ms >= 40 ? 'Medium' : 'Light' });
        return;
      } catch {
        // fall through
      }
    }
    if (navigator.vibrate) {
      navigator.vibrate(ms);
    }
  }

  function cancelVibration() {
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function appendPcmBuffer(chunk) {
    if (!chunk?.length) return;
    const merged = new Float32Array(speechPending.length + chunk.length);
    merged.set(speechPending, 0);
    merged.set(chunk, speechPending.length);
    speechPending = merged;
  }

  function frameRms(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) {
      const s = frame[i];
      sum += s * s;
    }
    return Math.sqrt(sum / frame.length);
  }

  function frameZcr(frame) {
    let crossings = 0;
    for (let i = 1; i < frame.length; i += 1) {
      if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) crossings += 1;
    }
    return crossings / frame.length;
  }

  function scheduleSpeechPulse(durationMs) {
    const now = performance.now();
    if (now - lastPulseAt < MIN_PULSE_GAP_MS) return;
    lastPulseAt = now;
    vibrateChain = vibrateChain
      .then(() => vibrateOnce(durationMs))
      .catch(() => {});
  }

  function analyzeSpeechFrame(frame) {
    const rms = frameRms(frame);
    if (rms < SILENCE_RMS) return;

    const zcr = frameZcr(frame);
    const energy = Math.min(1, rms / 0.22);

    if (zcr >= CONSONANT_ZCR && rms >= VOWEL_RMS * 0.75) {
      scheduleSpeechPulse(Math.round(12 + energy * 22));
      return;
    }

    if (rms >= VOWEL_RMS) {
      scheduleSpeechPulse(Math.round(32 + energy * 88));
      return;
    }

    if (rms >= SILENCE_RMS * 1.8) {
      scheduleSpeechPulse(14);
    }
  }

  function processSpeechBuffer() {
    while (speechPending.length >= FRAME_SAMPLES) {
      const frame = speechPending.subarray(0, FRAME_SAMPLES);
      analyzeSpeechFrame(frame);
      speechPending = speechPending.subarray(FRAME_SAMPLES);
    }
    if (speechPending.length > FRAME_SAMPLES * 10) {
      speechPending = speechPending.subarray(speechPending.length - FRAME_SAMPLES * 3);
    }
  }

  function startSustainLoop() {
    if (sustainTimer) return;
    sustainTimer = setInterval(() => {
      if (!speechSessionActive) {
        clearInterval(sustainTimer);
        sustainTimer = null;
        return;
      }
      const idle = performance.now() - lastFeedAt;
      if (idle > IDLE_END_MS && !isPlaybackScheduled()) {
        endSpeechSession();
        return;
      }
      processSpeechBuffer();
    }, 35);
  }

  function beginSpeechSession() {
    if (speechSessionActive) return;
    speechSessionActive = true;
    lastFeedAt = performance.now();
    startSustainLoop();
  }

  function endSpeechSession() {
    speechSessionActive = false;
    speechPending = new Float32Array(0);
    lastPulseAt = 0;
    if (sustainTimer) {
      clearInterval(sustainTimer);
      sustainTimer = null;
    }
    cancelVibration();
  }

  function feedSpeechPcm(float32Data, sampleRate = SPEECH_SAMPLE_RATE) {
    if (!speechEnabled || !float32Data?.length) return;
    if (!speechSessionActive) beginSpeechSession();
    lastFeedAt = performance.now();

    let data = float32Data;
    if (sampleRate !== SPEECH_SAMPLE_RATE) {
      const ratio = sampleRate / SPEECH_SAMPLE_RATE;
      const len = Math.max(1, Math.floor(float32Data.length / ratio));
      const resampled = new Float32Array(len);
      for (let i = 0; i < len; i += 1) {
        resampled[i] = float32Data[Math.floor(i * ratio)];
      }
      data = resampled;
    }

    appendPcmBuffer(data);
    processSpeechBuffer();
  }

  function stopSpeechHaptics() {
    endSpeechSession();
  }

  function touchSpeechSession() {
    lastFeedAt = performance.now();
  }

  function setSpeechHapticsEnabled(enabled) {
    speechEnabled = !!enabled;
    if (!speechEnabled) endSpeechSession();
  }

  async function onListeningStart() {
    await Promise.all([playTone(880, 0.07), vibrateOnce()]);
    await sleep(PAUSE_MS);
    await Promise.all([playTone(1175, 0.09), vibrateOnce()]);
  }

  async function onListeningStop() {
    endSpeechSession();
    await Promise.all([playTone(620, 0.11), vibrateOnce()]);
  }

  window.AIVA_HAPTICS = {
    onListeningStart,
    onListeningStop,
    beginSpeechSession,
    endSpeechSession,
    touchSpeechSession,
    feedSpeechPcm,
    stopSpeechHaptics,
    setSpeechHapticsEnabled,
  };
})();
