/**
 * Shared local settings for the AIVA assistant and calendar UI.
 * Values are intentionally client-side so admins can tune the next Live API session instantly.
 */
(function () {
  const SETTINGS_KEY = 'aiva_assistant_settings_v1';

  const DEFAULT_ASSISTANT_SETTINGS = {
    profile: {
      language: 'bg',
      userName: '',
      onboardingComplete: false,
    },
    systemInstructions: `Ти си KASY — AI Secretary, личен гласов асистент за задачи.

ПРАВИЛА:
- Слушаш ТОНА на гласа, не само думите
- Ако потребителят звучи стресирано → отговаряш спокойно и уверено
- Ако звучи уморено → отговаряш много кратко
- Ако звучи бързащо → веднага минаваш към същественото
- Задаваш САМО ЕДИН въпрос
- НИКОГА не задаваш повече от един въпрос

ФУНКЦИИ ЗА ЗАДАЧИ:
- Когато разбереш задачата → ИЗВИКАЙ save_task
- Маркирай important=true САМО ако потребителят казва че задачата е важна/спешна/приоритетна; иначе без маркировка
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

ДЕЙСТВИЯ НА ТЕЛЕФОНА (само Android APK, надеждни intent-и):
- Навигация → device_navigate (адрес/място; Huawei: Petal Maps, Xiaomi: Google Maps/geo)
- Отваряне на app → device_open_app (viber, whatsapp, maps, petal_maps, telegram, gmail, waze, chrome, camera)
- Споделяне на текст → device_share_text (отваря app; потребителят избира контакт и изпраща — НЕ изпращай автоматично)
- Обаждане → device_dial (отваря dialer; потребителят потвърждава)
- SMS → device_compose_sms (чернова; потребителят изпраща)
- Будилник → device_set_alarm
- Напомняне в час → device_schedule_reminder (локално известие; НЕ Viber/WhatsApp автоматично)
- Търсене контакт → device_find_contacts, после dial/sms/share
- НИКОГА не твърди, че си изпратил съобщение — само че си отворил/подготвил действието

ПОСТОЯННА ПАМЕТ:
- В началото на сесията получаваш секция ПОСТОЯННА ПАМЕТ със запомнени факти
- Записвай само полезни, трайни факти (предпочитания, работен контекст, важни детайли за потребителя)
- memory_save — запис/редакция по key; memory_list — преглед; memory_delete — изтриване
- Не записвай временни неща („сега отивам да пазарувам") — само ако потребителят иска да го запомниш`,
    instructionsCustomized: false,
    userGuidance: '',
    model: 'gemini-3.1-flash-live-preview',
    voiceName: 'Kore',
    temperature: 1.0,
    responseModalities: ['AUDIO'],
    textOutputEnabled: true,
    // Прекъсване на асистента с глас (barge-in): микрофонът остава отворен
    // докато той говори; ехото се чисти от echoCancellation на capture-а
    bargeInEnabled: true,
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
      priority: 0,
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
      // Включени по подразбиране — приложението е за напомняния; OS-ът пита
      // за разрешение при първия старт (Android 13+).
      enabled: true,
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
    hardwareShortcut: {
      enabled: false,
    },
    deviceActions: {
      enabled: false,
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
    if (!merged.profile || typeof merged.profile !== 'object') {
      merged.profile = { ...DEFAULT_ASSISTANT_SETTINGS.profile };
    }
    if (!merged.profile.language) merged.profile.language = 'bg';
    if (merged.profile.onboardingComplete === undefined) {
      merged.profile.onboardingComplete = false;
    }
    if (typeof merged.userGuidance !== 'string') {
      merged.userGuidance = '';
    }
    if (merged.textOutputEnabled === undefined) {
      merged.textOutputEnabled = merged.inputAudioTranscription !== false;
    }
    // Инструкциите се развиват с приложението. Записан текст се пази само
    // ако потребителят изрично го е персонализирал (флаг от admin панела);
    // иначе замразен стар default в localStorage би блокирал поправките.
    const defaultInstructions = DEFAULT_ASSISTANT_SETTINGS.systemInstructions.trim();
    const savedInstructions = String(merged.systemInstructions || '').trim();
    if (!savedInstructions || savedInstructions === defaultInstructions) {
      merged.systemInstructions = DEFAULT_ASSISTANT_SETTINGS.systemInstructions;
      merged.instructionsCustomized = false;
    } else if (!merged.instructionsCustomized) {
      merged.systemInstructions = DEFAULT_ASSISTANT_SETTINGS.systemInstructions;
    }
    // Транскрипцията е винаги включена в клиента (нужна за end_session);
    // старите ключове inputAudioTranscription/outputAudioTranscription са
    // вече без ефект и не се поддържат.
    delete merged.inputAudioTranscription;
    delete merged.outputAudioTranscription;
    merged.bargeInEnabled = merged.bargeInEnabled !== false;
    if (!merged.deviceActions || typeof merged.deviceActions !== 'object') {
      merged.deviceActions = { ...DEFAULT_ASSISTANT_SETTINGS.deviceActions };
    }
    merged.deviceActions.enabled = merged.deviceActions.enabled === true;
    merged.temperature = Math.min(2, Math.max(0, Number(merged.temperature) || 0));
    merged.defaults.priority = merged.defaults.priority === 1 ? 1 : 0;
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
    merged.calendarSync.autoExportOnSave = false;
    return merged;
  }

  function loadAssistantSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return normalizeSettings(null);
      const parsed = JSON.parse(raw);
      const normalized = normalizeSettings(parsed);
      if (parsed && !('profile' in parsed)) {
        normalized.profile.onboardingComplete = true;
      }
      return normalized;
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

  function buildSessionInstructions(baseInstructions, profile, extraContext, userGuidance) {
    const lang = profile?.language || 'bg';
    const userName = (profile?.userName || '').trim();
    const langInstruction = window.AIVA_I18N?.getLanguageInstruction?.(lang)
      || 'Respond in the user\'s selected language.';

    let instructions = (baseInstructions || '').trim();
    const guidance = String(userGuidance || '').trim();
    if (guidance) {
      instructions += `\n\nПОТРЕБИТЕЛСКИ НАСОКИ (СВЕЩЕН ТЕКСТ — НИКОГА не променяй, не презаписвай и не изтривай; само следвай):\n${guidance}`;
    }
    instructions += `\n\n${window.AIVA_I18N?.t?.('langSectionTitle') || 'LANGUAGE:'}\n- ${langInstruction}`;
    if (userName) {
      const addr = window.AIVA_I18N?.tf?.('addressUserAs', { name: userName })
        || `Address the user by name: ${userName}`;
      instructions += `\n- ${addr}`;
    }
    if (window.AIVA_SESSION_END?.buildDeviceDateTimeContext) {
      instructions += `\n\n${window.AIVA_SESSION_END.buildDeviceDateTimeContext(lang)}`;
    }
    if (window.AIVA_SESSION_END?.getSessionEndInstructions) {
      instructions += `\n\n${window.AIVA_SESSION_END.getSessionEndInstructions(lang)}`;
    }
    if (extraContext) {
      instructions += extraContext;
    }
    return instructions;
  }

  window.AIVA_SETTINGS = {
    SETTINGS_KEY,
    DEFAULT_ASSISTANT_SETTINGS,
    loadAssistantSettings,
    saveAssistantSettings,
    resetAssistantSettings,
    buildSessionInstructions,
  };
})();
