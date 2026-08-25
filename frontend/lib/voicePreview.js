/**
 * Fast voice preview for settings — uses REST TTS when available, Live API as fallback.
 */
(function () {
  let previewPlayer = null;
  let previewAborted = false;
  let cachedToken = null;
  let cachedTokenExpiresAt = 0;

  function getUserId() {
    return localStorage.getItem('aiva_user_id')
      || localStorage.getItem('kaya_user_id')
      || '';
  }

  async function fetchToken() {
    const now = Date.now();
    if (cachedToken && cachedTokenExpiresAt > now + 60000) {
      return cachedToken;
    }
    const { API_BASE } = window.AIVA_CONFIG;
    const userId = getUserId();
    const res = await fetch(`${API_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || 'Token error');
    }
    cachedToken = data.token;
    cachedTokenExpiresAt = data.expires_at ? Date.parse(data.expires_at) : now + 25 * 60 * 1000;
    return cachedToken;
  }

  function getPreviewPhrase(language) {
    return window.AIVA_I18N?.t?.('voicePreviewPhrase') || 'Hello, I am KASY, your AI Secretary.';
  }

  async function ensurePreviewPlayer({ resume = true } = {}) {
    if (!previewPlayer) {
      previewPlayer = new AudioPlayer({ minBufferSamples: 480 });
      await previewPlayer.init();
    } else if (!previewPlayer.isInitialized) {
      await previewPlayer.init();
    }
    if (resume && previewPlayer.audioContext?.state === 'suspended') {
      try {
        await previewPlayer.audioContext.resume();
      } catch {
        // Autoplay policy — resumes on the next user-triggered preview click.
      }
    }
    return previewPlayer;
  }

  async function stopPreview() {
    previewAborted = true;
    if (previewPlayer) {
      previewPlayer.interrupt?.();
    }
  }

  async function previewViaRest(opts) {
    const { API_BASE } = window.AIVA_CONFIG;
    const res = await fetch(`${API_BASE}/api/voice-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_name: opts.voiceName,
        text: getPreviewPhrase(opts.language),
        language: opts.language || 'bg',
        user_id: getUserId(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.audio) {
      throw new Error(data.error || 'Preview error');
    }
    const player = await ensurePreviewPlayer();
    previewAborted = false;
    await player.play(data.audio);
    await player.waitForDrain(8000);
  }

  async function previewViaLive(opts) {
    const token = await fetchToken();
    const model = opts.model || 'gemini-3.1-flash-live-preview';
    let previewClient = null;
    let previewEnding = false;

    const player = await ensurePreviewPlayer();
    previewAborted = false;

    await new Promise((resolve, reject) => {
      const client = new GeminiLiveAPI(token, model);
      previewClient = client;

      client.voiceName = opts.voiceName;
      client.temperature = opts.temperature ?? 1.0;
      client.responseModalities = ['AUDIO'];
      client.inputAudioTranscription = false;
      client.outputAudioTranscription = false;
      client.googleGrounding = false;
      client.systemInstructions = 'Speak only the requested sample phrase. No tools.';

      const timeout = setTimeout(() => {
        completePreview().then(resolve).catch(resolve);
      }, 15000);

      const completePreview = async () => {
        if (previewEnding) return;
        previewEnding = true;
        clearTimeout(timeout);
        if (previewClient?.webSocket) {
          try { previewClient.webSocket.close(); } catch { /* ignore */ }
        }
        previewClient = null;
        await player.waitForDrain(8000);
      };

      client.onReceiveResponse = async (message) => {
        if (previewAborted) return;
        switch (message.type) {
          case MultimodalLiveResponseType.SETUP_COMPLETE:
            client.sendTextMessage(`Say exactly: "${getPreviewPhrase(opts.language)}"`);
            break;
          case MultimodalLiveResponseType.AUDIO:
            await player.play(message.data);
            break;
          case MultimodalLiveResponseType.TURN_COMPLETE:
            await completePreview();
            resolve();
            break;
          case MultimodalLiveResponseType.ERROR:
            clearTimeout(timeout);
            reject(new Error(typeof message.data === 'string' ? message.data : 'Preview error'));
            break;
          default:
            break;
        }
      };

      client.onError = (msg) => {
        clearTimeout(timeout);
        reject(new Error(msg || 'Connection error'));
      };

      client.connect();
    });
  }

  async function prefetch() {
    try {
      await ensurePreviewPlayer();
    } catch {
      // warm-up is best-effort
    }
  }

  /**
   * @param {{ voiceName: string, model?: string, temperature?: number, language?: string }} opts
   */
  async function previewVoice(opts) {
    await stopPreview();
    previewAborted = false;
    let voiceSessionHeld = false;
    try {
      await window.AIVA_DEVICE_CONTEXT?.ensureMediaVolumeKeys?.();
      await window.AIVA_DEVICE_CONTEXT?.setVoiceSessionActive?.(true);
      voiceSessionHeld = true;
      try {
        await previewViaRest(opts);
      } catch (restErr) {
        console.warn('REST voice preview failed, falling back to Live:', restErr);
        await previewViaLive(opts);
      }
    } finally {
      if (voiceSessionHeld) {
        await window.AIVA_DEVICE_CONTEXT?.setVoiceSessionActive?.(false);
      }
    }
  }

  window.AIVA_VOICE_PREVIEW = {
    previewVoice,
    stopPreview,
    prefetch,
  };
})();
