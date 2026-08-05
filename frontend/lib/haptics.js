(function () {
  const PAUSE_MS = 90;
  const SPEECH_SAMPLE_RATE = 24000;
  const FRAME_SAMPLES = 480; // 20 ms @ 24 kHz — roughly phoneme-scale
  const MIN_PULSE_GAP_MS = 30;
  const SILENCE_RMS = 0.016;
  const VOWEL_RMS = 0.034;
  const CONSONANT_ZCR = 0.105;

  let audioCtx = null;
  let speechEnabled = true;
  let speechPending = new Float32Array(0);
  let lastPulseAt = 0;
  let vibrateChain = Promise.resolve();

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
    const Haptics = getCapacitorHaptics();
    if (Haptics?.vibrate) {
      try {
        await Haptics.vibrate({ duration: Math.max(8, Math.min(120, duration)) });
        return;
      } catch {
        // fall through
      }
    }
    if (Haptics?.impact) {
      try {
        await Haptics.impact({ style: duration >= 35 ? 'Medium' : 'Light' });
        return;
      } catch {
        // fall through
      }
    }
    if (navigator.vibrate) {
      navigator.vibrate(Math.max(8, Math.min(120, duration)));
    }
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

  function scheduleSpeechPulse(durationMs, kind) {
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
    const energy = Math.min(1, rms / 0.24);

    // High zero-crossing + energy → consonant (plosive / fricative)
    if (zcr >= CONSONANT_ZCR && rms >= VOWEL_RMS * 0.8) {
      scheduleSpeechPulse(Math.round(10 + energy * 16), 'consonant');
      return;
    }

    // Sustained energy, lower ZCR → vowel / sonorant
    if (rms >= VOWEL_RMS) {
      scheduleSpeechPulse(Math.round(26 + energy * 52), 'vowel');
      return;
    }

    // Weak transient between phonemes
    if (rms >= SILENCE_RMS * 2) {
      scheduleSpeechPulse(11, 'consonant');
    }
  }

  function processSpeechBuffer() {
    while (speechPending.length >= FRAME_SAMPLES) {
      const frame = speechPending.subarray(0, FRAME_SAMPLES);
      analyzeSpeechFrame(frame);
      speechPending = speechPending.subarray(FRAME_SAMPLES);
    }
    if (speechPending.length > FRAME_SAMPLES * 8) {
      speechPending = speechPending.subarray(speechPending.length - FRAME_SAMPLES * 2);
    }
  }

  function feedSpeechPcm(float32Data, sampleRate = SPEECH_SAMPLE_RATE) {
    if (!speechEnabled || !float32Data?.length) return;

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
    speechPending = new Float32Array(0);
    lastPulseAt = 0;
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function setSpeechHapticsEnabled(enabled) {
    speechEnabled = !!enabled;
    if (!speechEnabled) stopSpeechHaptics();
  }

  async function onListeningStart() {
    await Promise.all([playTone(880, 0.07), vibrateOnce()]);
    await sleep(PAUSE_MS);
    await Promise.all([playTone(1175, 0.09), vibrateOnce()]);
  }

  async function onListeningStop() {
    stopSpeechHaptics();
    await Promise.all([playTone(620, 0.11), vibrateOnce()]);
  }

  window.AIVA_HAPTICS = {
    onListeningStart,
    onListeningStop,
    feedSpeechPcm,
    stopSpeechHaptics,
    setSpeechHapticsEnabled,
  };
})();
