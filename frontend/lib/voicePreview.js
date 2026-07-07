/**
 * Short Gemini Live voice preview for settings — plays a sample phrase with the selected voice.
 */
(function () {
  let previewClient = null;
  let previewPlayer = null;
  let previewAborted = false;

  async function fetchToken() {
    const { API_BASE } = window.AIVA_CONFIG;
    const userId = localStorage.getItem('aiva_user_id') || '';
    const res = await fetch(`${API_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || 'Token error');
    }
    return data.token;
  }

  function getPreviewInstruction(language) {
    const phrase = window.AIVA_I18N?.t?.('voicePreviewPhrase') || 'Hello, I am AIVA.';
    const langInstruction = window.AIVA_I18N?.getLanguageInstruction?.(language)
      || 'Speak in the user\'s selected language.';
    return `${langInstruction}\nSay exactly this short sample phrase aloud, nothing else: "${phrase}"`;
  }

  async function stopPreview() {
    previewAborted = true;
    if (previewClient?.webSocket) {
      try {
        previewClient.webSocket.close();
      } catch {
        // ignore
      }
    }
    previewClient = null;
    if (previewPlayer) {
      previewPlayer.interrupt?.();
      previewPlayer = null;
    }
  }

  /**
   * @param {{ voiceName: string, model?: string, temperature?: number, language?: string }} opts
   */
  async function previewVoice(opts) {
    await stopPreview();
    previewAborted = false;

    const token = await fetchToken();
    const model = opts.model || 'gemini-3.1-flash-live-preview';

    return new Promise((resolve, reject) => {
      const client = new GeminiLiveAPI(token, model);
      previewClient = client;

      client.voiceName = opts.voiceName;
      client.temperature = opts.temperature ?? 1.0;
      client.responseModalities = ['AUDIO'];
      client.inputAudioTranscription = false;
      client.outputAudioTranscription = false;
      client.googleGrounding = false;
      client.systemInstructions = 'You are a voice preview assistant. Only speak the requested sample phrase. Do not use tools. Keep it brief.';

      const timeout = setTimeout(() => {
        stopPreview().then(resolve).catch(resolve);
      }, 15000);

      client.onReceiveResponse = async (message) => {
        if (previewAborted) return;
        switch (message.type) {
          case MultimodalLiveResponseType.SETUP_COMPLETE:
            client.sendTextMessage(getPreviewInstruction(opts.language || 'bg'));
            break;
          case MultimodalLiveResponseType.AUDIO:
            if (!previewPlayer) {
              previewPlayer = new AudioPlayer();
              await previewPlayer.init();
            }
            await previewPlayer.play(message.data);
            break;
          case MultimodalLiveResponseType.TURN_COMPLETE:
            clearTimeout(timeout);
            setTimeout(() => stopPreview().then(resolve).catch(resolve), 400);
            break;
          case MultimodalLiveResponseType.ERROR:
            clearTimeout(timeout);
            stopPreview().then(() => reject(new Error(typeof message.data === 'string' ? message.data : 'Preview error'))).catch(reject);
            break;
          default:
            break;
        }
      };

      client.onError = (msg) => {
        clearTimeout(timeout);
        stopPreview().then(() => reject(new Error(msg || 'Connection error'))).catch(reject);
      };

      client.onClose = () => {
        clearTimeout(timeout);
      };

      client.connect();
    });
  }

  window.AIVA_VOICE_PREVIEW = {
    previewVoice,
    stopPreview,
  };
})();
