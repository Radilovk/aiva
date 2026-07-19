/**
 * Bulgarian-friendly Gemini Live voices — curated for clear, natural Bulgarian speech.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */
(function () {
  const BULGARIAN_VOICES = [
    { name: 'Kore', character: 'Firm', note: 'Препоръчан' },
    { name: 'Puck', character: 'Upbeat', note: 'Ясен' },
    { name: 'Charon', character: 'Informative', note: 'Естествен' },
    { name: 'Zephyr', character: 'Bright', note: 'Лек' },
    { name: 'Aoede', character: 'Breezy', note: 'Плавен' },
    { name: 'Erinome', character: 'Clear', note: 'Чист' },
    { name: 'Iapetus', character: 'Clear', note: 'Спокоен' },
    { name: 'Despina', character: 'Smooth', note: 'Мек' },
    { name: 'Leda', character: 'Youthful', note: 'Свеж' },
    { name: 'Achird', character: 'Friendly', note: 'Приятелски' },
    { name: 'Schedar', character: 'Even', note: 'Равномерен' },
    { name: 'Sulafat', character: 'Warm', note: 'Топъл' },
  ];

  const GEMINI_LIVE_VOICES = BULGARIAN_VOICES;

  function populateVoiceSelect(selectEl, selectedVoice, filter = '') {
    if (!selectEl) return;
    const current = selectedVoice || selectEl.value;
    const query = String(filter || '').trim().toLowerCase();
    const filtered = query
      ? BULGARIAN_VOICES.filter((v) =>
        v.name.toLowerCase().includes(query)
        || v.character.toLowerCase().includes(query)
        || (v.note || '').toLowerCase().includes(query))
      : BULGARIAN_VOICES;

    selectEl.innerHTML = '';
    for (const voice of filtered) {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} — ${voice.character}${voice.note ? ` (${voice.note})` : ''}`;
      selectEl.appendChild(opt);
    }

    if (current && filtered.some((v) => v.name === current)) {
      selectEl.value = current;
    } else if (filtered.length) {
      const fallback = filtered.find((v) => v.name === 'Kore') || filtered[0];
      selectEl.value = fallback.name;
    }

    const hint = document.getElementById('voiceCountHint');
    if (hint) {
      hint.textContent = window.AIVA_I18N?.tf?.('voiceCountHint', { count: BULGARIAN_VOICES.length })
        || `${BULGARIAN_VOICES.length} voices optimized for Bulgarian`;
    }
  }

  function filterVoiceSelect(selectEl, query) {
    populateVoiceSelect(selectEl, selectEl?.value, query);
  }

  window.AIVA_VOICES = {
    GEMINI_LIVE_VOICES,
    BULGARIAN_VOICES,
    populateVoiceSelect,
    filterVoiceSelect,
  };
})();
