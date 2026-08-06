/**
 * Bulgarian-friendly Gemini Live voices — curated for clear, natural Bulgarian speech.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 * @see https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
 */
(function () {
  /**
   * Best default voice per UI language (Gemini Live / Chirp 3 HD).
   * Google does not publish per-language voice rankings; these picks combine
   * Chirp 3 locale support, voice character traits, and in-app Bulgarian testing.
   */
  const DEFAULT_VOICE_BY_LANGUAGE = {
    bg: 'Kore',     // Stable vowel spectrum; Fenrir alt for higher acoustic contrast
    en: 'Charon',   // Low formant frequency, precise pausing for technical speech
    zh: 'Erinome',  // Accurate tone contours without inter-tone distortion
    hi: 'Despina',  // Aspirated/retroflex consonants with smooth flow
    es: 'Puck',     // High dynamics for syllable-timed rhythm
    fr: 'Aoede',    // Nasal vowels and natural elision (liaison)
    de: 'Fenrir',   // Crisp plosives and consonant clusters
    ru: 'Fenrir',   // Clear contrast between hard and palatalized consonants
    ar: 'Sulafat',  // Emphatic/pharyngeal consonants with warm timbre
  };

  const BULGARIAN_VOICES = [
    { name: 'Kore', character: 'Firm', note: 'Препоръчан' },
    { name: 'Fenrir', character: 'Excitable', note: 'Контрастен' },
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

  function getDefaultVoiceForLanguage(lang) {
    const code = String(lang || 'bg').toLowerCase().split('-')[0];
    const voice = DEFAULT_VOICE_BY_LANGUAGE[code];
    if (voice && BULGARIAN_VOICES.some((v) => v.name === voice)) return voice;
    return 'Kore';
  }

  window.AIVA_VOICES = {
    GEMINI_LIVE_VOICES,
    BULGARIAN_VOICES,
    DEFAULT_VOICE_BY_LANGUAGE,
    getDefaultVoiceForLanguage,
    populateVoiceSelect,
    filterVoiceSelect,
  };
})();
