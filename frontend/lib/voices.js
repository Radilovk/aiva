/**
 * All 30 prebuilt HD voices supported by Google Gemini Live API.
 * @see https://ai.google.dev/gemini-api/docs/speech-generation
 */
(function () {
  const GEMINI_LIVE_VOICES = [
    { name: 'Achernar', character: 'Soft' },
    { name: 'Achird', character: 'Friendly' },
    { name: 'Algenib', character: 'Gravelly' },
    { name: 'Algieba', character: 'Smooth' },
    { name: 'Alnilam', character: 'Firm' },
    { name: 'Aoede', character: 'Breezy' },
    { name: 'Autonoe', character: 'Bright' },
    { name: 'Callirrhoe', character: 'Easy-going' },
    { name: 'Charon', character: 'Informative' },
    { name: 'Despina', character: 'Smooth' },
    { name: 'Enceladus', character: 'Breathy' },
    { name: 'Erinome', character: 'Clear' },
    { name: 'Fenrir', character: 'Excitable' },
    { name: 'Gacrux', character: 'Mature' },
    { name: 'Iapetus', character: 'Clear' },
    { name: 'Kore', character: 'Firm' },
    { name: 'Laomedeia', character: 'Upbeat' },
    { name: 'Leda', character: 'Youthful' },
    { name: 'Orus', character: 'Firm' },
    { name: 'Puck', character: 'Upbeat' },
    { name: 'Pulcherrima', character: 'Forward' },
    { name: 'Rasalgethi', character: 'Informative' },
    { name: 'Sadachbia', character: 'Lively' },
    { name: 'Sadaltager', character: 'Knowledgeable' },
    { name: 'Schedar', character: 'Even' },
    { name: 'Sulafat', character: 'Warm' },
    { name: 'Umbriel', character: 'Easy-going' },
    { name: 'Vindemiatrix', character: 'Gentle' },
    { name: 'Zephyr', character: 'Bright' },
    { name: 'Zubenelgenubi', character: 'Casual' },
  ];

  const CHARACTER_ORDER = [
    'Bright', 'Upbeat', 'Youthful', 'Lively', 'Excitable', 'Breezy', 'Warm',
    'Friendly', 'Gentle', 'Soft', 'Casual', 'Easy-going', 'Smooth', 'Clear',
    'Even', 'Firm', 'Forward', 'Mature', 'Knowledgeable', 'Informative',
    'Breathy', 'Gravelly',
  ];

  function groupVoicesByCharacter(voices) {
    const groups = new Map();
    for (const voice of voices) {
      const key = voice.character || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(voice);
    }
    const ordered = [];
    for (const character of CHARACTER_ORDER) {
      if (groups.has(character)) {
        ordered.push({ character, voices: groups.get(character) });
        groups.delete(character);
      }
    }
    for (const [character, list] of groups) {
      ordered.push({ character, voices: list });
    }
    return ordered;
  }

  function populateVoiceSelect(selectEl, selectedVoice, filter = '') {
    if (!selectEl) return;
    const current = selectedVoice || selectEl.value;
    const query = String(filter || '').trim().toLowerCase();
    const filtered = query
      ? GEMINI_LIVE_VOICES.filter((v) =>
        v.name.toLowerCase().includes(query) || v.character.toLowerCase().includes(query))
      : GEMINI_LIVE_VOICES;

    selectEl.innerHTML = '';
    for (const group of groupVoicesByCharacter(filtered)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.character;
      for (const voice of group.voices) {
        const opt = document.createElement('option');
        opt.value = voice.name;
        opt.textContent = `${voice.name} — ${voice.character}`;
        optgroup.appendChild(opt);
      }
      selectEl.appendChild(optgroup);
    }

    if (current && filtered.some((v) => v.name === current)) {
      selectEl.value = current;
    } else if (filtered.length) {
      const fallback = filtered.find((v) => v.name === 'Kore') || filtered[0];
      selectEl.value = fallback.name;
    }

    const hint = document.getElementById('voiceCountHint');
    if (hint) {
      const total = GEMINI_LIVE_VOICES.length;
      const shown = filtered.length;
      const base = window.AIVA_I18N?.t?.('voiceCountHint') || `${total} HD voices from Google Gemini Live (full list)`;
      hint.textContent = query && shown !== total
        ? `${shown} / ${total} — ${base}`
        : base.replace('{count}', String(total));
    }
  }

  function filterVoiceSelect(selectEl, query) {
    populateVoiceSelect(selectEl, selectEl?.value, query);
  }

  window.AIVA_VOICES = {
    GEMINI_LIVE_VOICES,
    populateVoiceSelect,
    filterVoiceSelect,
  };
})();
