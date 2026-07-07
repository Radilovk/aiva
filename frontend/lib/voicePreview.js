/**
 * Short Gemini Live voice preview for settings — plays a sample phrase with the selected voice.
 */
(function () {
  let previewClient = null;
  let previewPlayer = null;
  let previewAborted = false;
  let previewEnding = false;

  function getUserId() {
    return localStorage.getItem('kaya_user_id')
      || localStorage.getItem('aiva_user_id')
      || '';
  }

  async function fetchToken() {
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
    return data.token;
  }

  function getPreviewInstruction(language) {
    const phrase = window.AIVA_I18N?.t?.('voicePreviewPhrase') || 'Hello, I am KAYA.';
    const langInstruction = window.AIVA_I18N?.getLanguageInstruction?.(language)
      || 'Speak in the user\'s selected language.';
    return `${langInstruction}\nSay exactly this short sample phrase aloud, nothing else: "${phrase}"`;
  }

  async function finishPreview(resolve) {
    if (previewPlayer) {
      await previewPlayer.waitForDrain(12000);
    }
    await stopPreview();
    resolve?.();
  }

  async function stopPreview() {
    previewAborted = true;
    previewEnding = false;
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
    previewEnding = false;

    previewPlayer = new AudioPlayer();
    await previewPlayer.init();

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
        finishPreview(resolve).catch(resolve);
      }, 20000);

      const onTurnComplete = () => {
        if (previewAborted || previewEnding) return;
        previewEnding = true;
        clearTimeout(timeout);
        finishPreview(resolve).catch(resolve);
      };

      client.onReceiveResponse = async (message) => {
        if (previewAborted) return;
        switch (message.type) {
          case MultimodalLiveResponseType.SETUP_COMPLETE:
            client.sendTextMessage(getPreviewInstruction(opts.language || 'bg'));
            break;
          case MultimodalLiveResponseType.AUDIO:
            await previewPlayer.play(message.data);
            break;
          case MultimodalLiveResponseType.TURN_COMPLETE:
            onTurnComplete();
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
        if (!previewEnding && !previewAborted) {
          clearTimeout(timeout);
          finishPreview(resolve).catch(resolve);
        }
      };

      client.connect();
    });
  }

  window.AIVA_VOICE_PREVIEW = {
    previewVoice,
    stopPreview,
  };
})();
