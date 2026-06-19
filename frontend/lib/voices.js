/**
 * All 30 prebuilt voices supported by Google Gemini Live API.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */
(function () {
  const GEMINI_LIVE_VOICES = [
    { name: 'Zephyr', character: 'Bright' },
    { name: 'Puck', character: 'Upbeat' },
    { name: 'Charon', character: 'Informative' },
    { name: 'Kore', character: 'Firm' },
    { name: 'Fenrir', character: 'Excitable' },
    { name: 'Leda', character: 'Youthful' },
    { name: 'Orus', character: 'Firm' },
    { name: 'Aoede', character: 'Breezy' },
    { name: 'Callirrhoe', character: 'Easy-going' },
    { name: 'Autonoe', character: 'Bright' },
    { name: 'Enceladus', character: 'Breathy' },
    { name: 'Iapetus', character: 'Clear' },
    { name: 'Umbriel', character: 'Easy-going' },
    { name: 'Algenib', character: 'Gravelly' },
    { name: 'Despina', character: 'Smooth' },
    { name: 'Erinome', character: 'Clear' },
    { name: 'Laomedeia', character: 'Upbeat' },
    { name: 'Achernar', character: 'Soft' },
    { name: 'Algieba', character: 'Smooth' },
    { name: 'Schedar', character: 'Even' },
    { name: 'Gacrux', character: 'Mature' },
    { name: 'Pulcherrima', character: 'Forward' },
    { name: 'Achird', character: 'Friendly' },
    { name: 'Zubenelgenubi', character: 'Casual' },
    { name: 'Vindemiatrix', character: 'Gentle' },
    { name: 'Sadachbia', character: 'Lively' },
    { name: 'Sadaltager', character: 'Knowledgeable' },
    { name: 'Sulafat', character: 'Warm' },
    { name: 'Alnilam', character: 'Firm' },
    { name: 'Rasalgethi', character: 'Informative' },
  ];

  function populateVoiceSelect(selectEl, selectedVoice) {
    if (!selectEl) return;
    const current = selectedVoice || selectEl.value;
    selectEl.innerHTML = '';
    for (const voice of GEMINI_LIVE_VOICES) {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} — ${voice.character}`;
      selectEl.appendChild(opt);
    }
    if (current && GEMINI_LIVE_VOICES.some((v) => v.name === current)) {
      selectEl.value = current;
    } else if (GEMINI_LIVE_VOICES.length) {
      selectEl.value = GEMINI_LIVE_VOICES.find((v) => v.name === 'Kore')?.name || GEMINI_LIVE_VOICES[0].name;
    }
  }

  window.AIVA_VOICES = {
    GEMINI_LIVE_VOICES,
    populateVoiceSelect,
  };
})();
