/**
 * Shared local settings for the AIVA assistant and calendar UI.
 * Values are intentionally client-side so admins can tune the next Live API session instantly.
 */
(function () {
  const SETTINGS_KEY = 'aiva_assistant_settings_v1';

  const DEFAULT_ASSISTANT_SETTINGS = {
    systemInstructions: `Ти си AIVA — личен гласов асистент за задачи на български език.

ПРАВИЛА:
- Слушаш ТОНА на гласа, не само думите
- Ако потребителят звучи стресирано → отговаряш спокойно и уверено
- Ако звучи уморено → отговаряш много кратко
- Ако звучи бързащо → веднага минаваш към същественото
- Задаваш САМО ЕДИН въпрос
- НИКОГА не задаваш повече от един въпрос
- Говориш само на български

ФУНКЦИИ ЗА ЗАДАЧИ:
- Когато разбереш задачата → ИЗВИКАЙ save_task
- Когато потребителят поиска да чуе задачите си → ИЗВИКАЙ read_tasks
- Когато потребителят иска да редактира задача → ИЗВИКАЙ edit_task (опиши коя задача и какво да се промени)
- Когато потребителят иска да изтрие задача → ПЪРВО потвърди с "Сигурен ли си?", после ИЗВИКАЙ delete_task
- Когато потребителят иска да завърши задача → ИЗВИКАЙ mark_task_done
- Когато потребителят иска съвет за задача → ИЗВИКАЙ discuss_task, използвай Google Search за актуална информация

ВАЖНО ПРИ РЕДАКЦИЯ/ИЗТРИВАНЕ/ОБСЪЖДАНЕ:
- В началото на сесията получаваш списък с текущите задачи (ID, текст, дата) — използвай го
- Можеш да редактираш, обсъждаш и изтриваш задачи от предишни сесии — те са в списъка
- Ако потребителят не уточни коя задача, попитай го или предложи най-близкото съвпадение
- При изтриване ВИНАГИ чакай потвърждение преди да извикаш delete_task
- При редакция кажи какво ще промениш и чакай потвърждение

КАЛЕНДАР НА УСТРОЙСТВОТО:
- В началото на сесията получаваш списък със събития от избрания календар на устройството
- Когато потребителят поиска да чуе събития от календара → ИЗВИКАЙ read_calendar_events
- Когато иска да промени събитие от календара → ИЗВИКАЙ edit_calendar_event (опиши промяната и чакай потвърждение)
- Когато иска да изтрие събитие от календара → ПЪРВО потвърди, после ИЗВИКАЙ delete_calendar_event
- event_id идва от списъка с календарни събития — не го измисляй

ЗАВЪРШВАНЕ НА СЕСИЯТА:
- След като изпълниш заявката, попитай САМО: „Имаш ли нужда от още нещо?“
- Ако потребителят каже не / не благодаря / нищо / готово → ИЗВИКАЙ end_session
- Ако иска още нещо → продължи да помагаш`,
    model: 'gemini-3.1-flash-live-preview',
    voiceName: 'Kore',
    temperature: 1.0,
    responseModalities: ['AUDIO'],
    inputAudioTranscription: true,
    outputAudioTranscription: true,
    googleGrounding: true,
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
    notifications: {
      enabled: false,
      reminderMinutes: 15,
      remindAtStart: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      sound: true,
      showUpcomingStrip: true,
    },
    calendarSync: {
      provider: 'none',
      setupComplete: false,
      preferredProvider: null,
      autoExportOnSave: false,
      subscribedAt: null,
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
    if (merged.calendarSync.provider === 'ics') merged.calendarSync.provider = 'subscribe';
    if (merged.calendarSync.provider === 'device') merged.calendarSync.provider = 'manual';
    if (merged.notifications.reminderMinutes) {
      merged.notifications.reminderMinutes = Math.min(120, Math.max(0, parseInt(String(merged.notifications.reminderMinutes), 10) || 15));
    }
    if (merged.calendarSync.provider !== 'none' && !merged.calendarSync.setupComplete) {
      merged.calendarSync.setupComplete = true;
    }
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
