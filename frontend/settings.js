/**
 * Shared local settings for the AIVA assistant and calendar UI.
 * Values are intentionally client-side so admins can tune the next Live API session instantly.
 */
(function () {
  const SETTINGS_KEY = 'aiva_assistant_settings_v1';

  const DEFAULT_ASSISTANT_SETTINGS = {
    systemInstructions: `Ти си личен асистент за задачи на български език.

ПРАВИЛА:
- Слушаш ТОНА на гласа, не само думите
- Ако потребителят звучи стресирано → отговаряш спокойно и уверено
- Ако звучи уморено → отговаряш много кратко
- Ако звучи бързащо → веднага минаваш към същественото
- Задаваш САМО ЕДИН въпрос
- НИКОГА не задаваш повече от един въпрос
- Говориш само на български
- Когато разбереш задачата, ИЗВИКАЙ функцията save_task с правилните параметри`,
    model: 'gemini-3.1-flash-live-preview',
    voiceName: 'Kore',
    temperature: 1.0,
    responseModalities: ['AUDIO'],
    inputAudioTranscription: true,
    outputAudioTranscription: false,
    googleGrounding: false,
    automaticActivityDetection: {
      disabled: false,
      silence_duration_ms: 2000,
      prefix_padding_ms: 500,
      end_of_speech_sensitivity: 'END_SENSITIVITY_UNSPECIFIED',
      start_of_speech_sensitivity: 'START_SENSITIVITY_UNSPECIFIED',
    },
    activityHandling: 'ACTIVITY_HANDLING_UNSPECIFIED',
    calendar: {
      defaultView: 'day',
      weekStartsOn: 1,
      workingDayStart: '08:00',
      workingDayEnd: '18:00',
      showUnscheduled: true,
    },
    defaults: {
      priority: 3,
      estimatedMinutes: 30,
      dueTime: '09:00',
      emotion: 'neutral',
    },
    safety: {
      askBeforeDelete: true,
      showCompletedTasks: false,
      maxDuplicateDays: 30,
    },
    appearance: {
      accentColor: '#ff3b5c',
      compactCalendar: false,
    },
  };

  function deepMerge(base, override) {
    if (!override || typeof override !== 'object') return structuredClone(base);
    const output = Array.isArray(base) ? [...base] : { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (Array.isArray(value)) {
        output[key] = [...value];
      } else if (value && typeof value === 'object' && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        output[key] = deepMerge(base[key], value);
      } else if (value !== undefined) {
        output[key] = value;
      }
    }

    return output;
  }

  function normalizeSettings(settings) {
    const merged = deepMerge(DEFAULT_ASSISTANT_SETTINGS, settings);
    merged.temperature = Math.min(2, Math.max(0, Number(merged.temperature) || 0));
    merged.defaults.priority = Math.min(5, Math.max(1, parseInt(String(merged.defaults.priority), 10) || 3));
    merged.defaults.estimatedMinutes = Math.max(0, parseInt(String(merged.defaults.estimatedMinutes), 10) || 0);
    merged.safety.maxDuplicateDays = Math.min(365, Math.max(1, parseInt(String(merged.safety.maxDuplicateDays), 10) || 30));
    return merged;
  }

  function loadAssistantSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : null);
    } catch (e) {
      console.warn('AIVA settings reset after invalid localStorage payload:', e);
      return normalizeSettings(null);
    }
  }

  function saveAssistantSettings(settings) {
    const normalized = normalizeSettings(settings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent('aiva:settings-updated', { detail: normalized }));
    return normalized;
  }

  function resetAssistantSettings() {
    localStorage.removeItem(SETTINGS_KEY);
    const settings = loadAssistantSettings();
    window.dispatchEvent(new CustomEvent('aiva:settings-updated', { detail: settings }));
    return settings;
  }

  window.AIVA_SETTINGS = {
    SETTINGS_KEY,
    DEFAULT_ASSISTANT_SETTINGS,
    loadAssistantSettings,
    saveAssistantSettings,
    resetAssistantSettings,
  };
})();
