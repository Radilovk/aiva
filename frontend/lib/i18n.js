/**
 * Internationalization for AIVA — 6 languages: English, Chinese, Hindi, Spanish, Arabic, Bulgarian.
 */
(function () {
  const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English', nativeLabel: 'English', bcp47: 'en-US', rtl: false },
    { code: 'zh', label: 'Chinese', nativeLabel: '中文', bcp47: 'zh-CN', rtl: false },
    { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', bcp47: 'hi-IN', rtl: false },
    { code: 'es', label: 'Spanish', nativeLabel: 'Español', bcp47: 'es-ES', rtl: false },
    { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', bcp47: 'ar-SA', rtl: true },
    { code: 'bg', label: 'Bulgarian', nativeLabel: 'Български', bcp47: 'bg-BG', rtl: false },
  ];

  const STRINGS = {
    en: {
      tagline: 'voice task assistant',
      settings: 'Settings',
      calendar: 'Calendar',
      connectCalendar: 'Connect',
      calendarBanner: 'Connect your calendar — tasks will appear automatically with reminders',
      upcoming: 'Upcoming',
      tapToRecord: 'Tap to record',
      listening: 'Listening...',
      connecting: 'Connecting...',
      stopRecording: 'Stop recording',
      record: 'Record',
      tasksTitle: 'Calendar',
      addTask: '+ Task',
      prevPeriod: 'Previous period',
      nextPeriod: 'Next period',
      viewDay: 'Day',
      viewThree: '3 days',
      viewWeek: 'Week',
      viewMonth: 'Month',
      today: 'Today',
      emptyTasks: 'No tasks yet',
      taskDetails: 'Task details',
      newTask: 'New task',
      close: 'Close',
      saved: 'Saved',
      onboardingLangTitle: 'Choose your language',
      onboardingLangSubtitle: 'The interface, assistant, and text output will use this language.',
      onboardingNameTitle: 'Your name',
      onboardingNameSubtitle: 'How should the assistant address you?',
      onboardingNamePlaceholder: 'e.g. Maria',
      onboardingIntroTitle: 'Welcome to AIVA',
      onboardingIntroBody: 'AIVA is your personal voice assistant for tasks and calendar.\n\n• Speak naturally to create, edit, and complete tasks\n• Sync tasks with your device calendar\n• Get reminders for upcoming commitments\n• Discuss tasks and get advice with web search',
      continue: 'Continue',
      getStarted: 'Get started',
      skip: 'Skip',
      profile: 'Profile',
      language: 'Language',
      yourName: 'Your name',
      yourNameHint: 'How the assistant addresses you',
      voiceAssistant: 'Voice assistant',
      voice: 'Voice',
      model: 'Model',
      temperature: 'Temperature (creativity)',
      googleGrounding: 'Google Grounding (web access)',
      textOutput: 'Text output',
      textOutputHint: 'Show conversation as text in the selected language',
      backHome: '← Home',
      settingsTitle: 'Settings',
      save: 'Save',
      reset: 'Reset',
      settingsSaved: 'Settings saved',
      notifications: 'Notifications',
      askAnything: 'Do you need anything else?',
    },
    zh: {
      tagline: '语音任务助手',
      settings: '设置',
      calendar: '日历',
      connectCalendar: '连接',
      calendarBanner: '连接日历 — 任务将自动显示并提醒',
      upcoming: '即将到来',
      tapToRecord: '点击录音',
      listening: '正在聆听...',
      connecting: '连接中...',
      stopRecording: '停止录音',
      record: '录音',
      tasksTitle: '日历',
      addTask: '+ 任务',
      prevPeriod: '上一时段',
      nextPeriod: '下一时段',
      viewDay: '日',
      viewThree: '3天',
      viewWeek: '周',
      viewMonth: '月',
      today: '今天',
      emptyTasks: '暂无任务',
      taskDetails: '任务详情',
      newTask: '新任务',
      close: '关闭',
      saved: '已保存',
      onboardingLangTitle: '选择语言',
      onboardingLangSubtitle: '界面、助手和文字输出将使用此语言。',
      onboardingNameTitle: '您的名字',
      onboardingNameSubtitle: '助手应如何称呼您？',
      onboardingNamePlaceholder: '例如：小明',
      onboardingIntroTitle: '欢迎使用 AIVA',
      onboardingIntroBody: 'AIVA 是您的个人语音任务和日历助手。\n\n• 自然说话即可创建、编辑和完成任务\n• 与设备日历同步任务\n• 获取即将到来的提醒\n• 讨论任务并通过网络搜索获取建议',
      continue: '继续',
      getStarted: '开始使用',
      skip: '跳过',
      profile: '个人资料',
      language: '语言',
      yourName: '您的名字',
      yourNameHint: '助手如何称呼您',
      voiceAssistant: '语音助手',
      voice: '语音',
      model: '模型',
      temperature: '温度（创造性）',
      googleGrounding: 'Google Grounding（网络访问）',
      textOutput: '文字输出',
      textOutputHint: '以所选语言显示对话文字',
      backHome: '← 首页',
      settingsTitle: '设置',
      save: '保存',
      reset: '重置',
      settingsSaved: '设置已保存',
      notifications: '通知',
      askAnything: '还需要其他帮助吗？',
    },
    hi: {
      tagline: 'वॉइस टास्क असिस्टेंट',
      settings: 'सेटिंग्स',
      calendar: 'कैलेंडर',
      connectCalendar: 'कनेक्ट करें',
      calendarBanner: 'अपना कैलेंडर कनेक्ट करें — कार्य स्वचालित रूप से दिखेंगे',
      upcoming: 'आगामी',
      tapToRecord: 'रिकॉर्ड करने के लिए टैप करें',
      listening: 'सुन रहा हूँ...',
      connecting: 'कनेक्ट हो रहा है...',
      stopRecording: 'रिकॉर्डिंग बंद करें',
      record: 'रिकॉर्ड',
      tasksTitle: 'कैलेंडर',
      addTask: '+ कार्य',
      prevPeriod: 'पिछली अवधि',
      nextPeriod: 'अगली अवधि',
      viewDay: 'दिन',
      viewThree: '3 दिन',
      viewWeek: 'सप्ताह',
      viewMonth: 'महीना',
      today: 'आज',
      emptyTasks: 'अभी कोई कार्य नहीं',
      taskDetails: 'कार्य विवरण',
      newTask: 'नया कार्य',
      close: 'बंद करें',
      saved: 'सहेजा गया',
      onboardingLangTitle: 'अपनी भाषा चुनें',
      onboardingLangSubtitle: 'इंटरफ़ेस, असिस्टेंट और टेक्स्ट आउटपुट इस भाषा में होंगे।',
      onboardingNameTitle: 'आपका नाम',
      onboardingNameSubtitle: 'असिस्टेंट आपको कैसे संबोधित करे?',
      onboardingNamePlaceholder: 'उदा. राहुल',
      onboardingIntroTitle: 'AIVA में आपका स्वागत है',
      onboardingIntroBody: 'AIVA आपका व्यक्तिगत वॉइस टास्क और कैलेंडर असिस्टेंट है।\n\n• प्राकृतिक रूप से बोलकर कार्य बनाएं, संपादित करें और पूरे करें\n• डिवाइस कैलेंडर के साथ सिंक करें\n• आगामी कार्यों के लिए रिमाइंडर पाएं\n• कार्यों पर चर्चा करें और वेब खोज से सलाह लें',
      continue: 'जारी रखें',
      getStarted: 'शुरू करें',
      skip: 'छोड़ें',
      profile: 'प्रोफ़ाइल',
      language: 'भाषा',
      yourName: 'आपका नाम',
      yourNameHint: 'असिस्टेंट आपको कैसे बुलाए',
      voiceAssistant: 'वॉइस असिस्टेंट',
      voice: 'आवाज़',
      model: 'मॉडल',
      temperature: 'तापमान (रचनात्मकता)',
      googleGrounding: 'Google Grounding (वेब एक्सेस)',
      textOutput: 'टेक्स्ट आउटपुट',
      textOutputHint: 'चयनित भाषा में बातचीत टेक्स्ट के रूप में दिखाएं',
      backHome: '← होम',
      settingsTitle: 'सेटिंग्स',
      save: 'सहेजें',
      reset: 'रीसेट',
      settingsSaved: 'सेटिंग्स सहेजी गईं',
      notifications: 'सूचनाएं',
      askAnything: 'क्या आपको और कुछ चाहिए?',
    },
    es: {
      tagline: 'asistente de voz para tareas',
      settings: 'Ajustes',
      calendar: 'Calendario',
      connectCalendar: 'Conectar',
      calendarBanner: 'Conecta tu calendario — las tareas aparecerán automáticamente con recordatorios',
      upcoming: 'Próximas',
      tapToRecord: 'Toca para grabar',
      listening: 'Escuchando...',
      connecting: 'Conectando...',
      stopRecording: 'Detener grabación',
      record: 'Grabar',
      tasksTitle: 'Calendario',
      addTask: '+ Tarea',
      prevPeriod: 'Período anterior',
      nextPeriod: 'Período siguiente',
      viewDay: 'Día',
      viewThree: '3 días',
      viewWeek: 'Semana',
      viewMonth: 'Mes',
      today: 'Hoy',
      emptyTasks: 'Aún no hay tareas',
      taskDetails: 'Detalles de la tarea',
      newTask: 'Nueva tarea',
      close: 'Cerrar',
      saved: 'Guardada',
      onboardingLangTitle: 'Elige tu idioma',
      onboardingLangSubtitle: 'La interfaz, el asistente y el texto usarán este idioma.',
      onboardingNameTitle: 'Tu nombre',
      onboardingNameSubtitle: '¿Cómo debe dirigirse el asistente a ti?',
      onboardingNamePlaceholder: 'ej. María',
      onboardingIntroTitle: 'Bienvenido a AIVA',
      onboardingIntroBody: 'AIVA es tu asistente personal de voz para tareas y calendario.\n\n• Habla naturalmente para crear, editar y completar tareas\n• Sincroniza con el calendario del dispositivo\n• Recibe recordatorios de compromisos próximos\n• Discute tareas y obtén consejos con búsqueda web',
      continue: 'Continuar',
      getStarted: 'Empezar',
      skip: 'Omitir',
      profile: 'Perfil',
      language: 'Idioma',
      yourName: 'Tu nombre',
      yourNameHint: 'Cómo te llama el asistente',
      voiceAssistant: 'Asistente de voz',
      voice: 'Voz',
      model: 'Modelo',
      temperature: 'Temperatura (creatividad)',
      googleGrounding: 'Google Grounding (acceso web)',
      textOutput: 'Salida de texto',
      textOutputHint: 'Mostrar la conversación como texto en el idioma seleccionado',
      backHome: '← Inicio',
      settingsTitle: 'Ajustes',
      save: 'Guardar',
      reset: 'Restablecer',
      settingsSaved: 'Ajustes guardados',
      notifications: 'Notificaciones',
      askAnything: '¿Necesitas algo más?',
    },
    ar: {
      tagline: 'مساعد صوتي للمهام',
      settings: 'الإعدادات',
      calendar: 'التقويم',
      connectCalendar: 'ربط',
      calendarBanner: 'اربط تقويمك — ستظهر المهام تلقائياً مع التذكيرات',
      upcoming: 'القادمة',
      tapToRecord: 'اضغط للتسجيل',
      listening: 'أستمع...',
      connecting: 'جارٍ الاتصال...',
      stopRecording: 'إيقاف التسجيل',
      record: 'تسجيل',
      tasksTitle: 'التقويم',
      addTask: '+ مهمة',
      prevPeriod: 'الفترة السابقة',
      nextPeriod: 'الفترة التالية',
      viewDay: 'يوم',
      viewThree: '3 أيام',
      viewWeek: 'أسبوع',
      viewMonth: 'شهر',
      today: 'اليوم',
      emptyTasks: 'لا توجد مهام بعد',
      taskDetails: 'تفاصيل المهمة',
      newTask: 'مهمة جديدة',
      close: 'إغلاق',
      saved: 'تم الحفظ',
      onboardingLangTitle: 'اختر لغتك',
      onboardingLangSubtitle: 'ستستخدم الواجهة والمساعد والنص هذه اللغة.',
      onboardingNameTitle: 'اسمك',
      onboardingNameSubtitle: 'كيف يجب أن يناديك المساعد؟',
      onboardingNamePlaceholder: 'مثال: أحمد',
      onboardingIntroTitle: 'مرحباً بك في AIVA',
      onboardingIntroBody: 'AIVA هو مساعدك الصوتي الشخصي للمهام والتقويم.\n\n• تحدث بشكل طبيعي لإنشاء المهام وتعديلها وإكمالها\n• مزامنة المهام مع تقويم الجهاز\n• تذكيرات للالتزامات القادمة\n• ناقش المهام واحصل على نصائح عبر البحث',
      continue: 'متابعة',
      getStarted: 'ابدأ',
      skip: 'تخطي',
      profile: 'الملف الشخصي',
      language: 'اللغة',
      yourName: 'اسمك',
      yourNameHint: 'كيف يناديك المساعد',
      voiceAssistant: 'المساعد الصوتي',
      voice: 'الصوت',
      model: 'النموذج',
      temperature: 'درجة الحرارة (الإبداع)',
      googleGrounding: 'Google Grounding (الوصول للويب)',
      textOutput: 'إخراج نصي',
      textOutputHint: 'عرض المحادثة كنص باللغة المختارة',
      backHome: '← الرئيسية',
      settingsTitle: 'الإعدادات',
      save: 'حفظ',
      reset: 'إعادة تعيين',
      settingsSaved: 'تم حفظ الإعدادات',
      notifications: 'الإشعارات',
      askAnything: 'هل تحتاج إلى شيء آخر؟',
    },
    bg: {
      tagline: 'гласов асистент за задачи',
      settings: 'Настройки',
      calendar: 'Календар',
      connectCalendar: 'Свържи',
      calendarBanner: 'Свържи календара си — задачите ще се появяват автоматично с напомняния',
      upcoming: 'Предстоящи',
      tapToRecord: 'Докоснете за запис',
      listening: 'Слушам...',
      connecting: 'Свързване...',
      stopRecording: 'Спри записа',
      record: 'Запис',
      tasksTitle: 'Календар',
      addTask: '+ Задача',
      prevPeriod: 'Предишен период',
      nextPeriod: 'Следващ период',
      viewDay: 'Ден',
      viewThree: '3 дни',
      viewWeek: 'Календар',
      viewMonth: 'Месец',
      today: 'Днес',
      emptyTasks: 'Все още няма задачи',
      taskDetails: 'Детайли за задачата',
      newTask: 'Нова задача',
      close: 'Затвори',
      saved: 'Запазена',
      onboardingLangTitle: 'Изберете език',
      onboardingLangSubtitle: 'Интерфейсът, асистентът и текстовото извеждане ще бъдат на този език.',
      onboardingNameTitle: 'Вашето име',
      onboardingNameSubtitle: 'Как асистентът да се обръща към вас?',
      onboardingNamePlaceholder: 'напр. Иван',
      onboardingIntroTitle: 'Добре дошли в AIVA',
      onboardingIntroBody: 'AIVA е вашият личен гласов асистент за задачи и календар.\n\n• Говорете естествено, за да създавате, редактирате и завършвате задачи\n• Синхронизирайте задачи с календара на устройството\n• Получавайте напомняния за предстоящи ангажименти\n• Обсъждайте задачи и получавайте съвети с уеб търсене',
      continue: 'Продължи',
      getStarted: 'Започни',
      skip: 'Пропусни',
      profile: 'Профил',
      language: 'Език',
      yourName: 'Вашето име',
      yourNameHint: 'Как асистентът да се обръща към вас',
      voiceAssistant: 'Гласов асистент',
      voice: 'Глас',
      model: 'Модел',
      temperature: 'Температура (креативност)',
      googleGrounding: 'Google Grounding (интернет достъп)',
      textOutput: 'Текстово извеждане',
      textOutputHint: 'Показва разговора като текст на избрания език',
      backHome: '← Начало',
      settingsTitle: 'Настройки',
      save: 'Запази',
      reset: 'Нулирай',
      settingsSaved: 'Настройките са запазени',
      notifications: 'Нотификации',
      askAnything: 'Имаш ли нужда от още нещо?',
    },
  };

  const LANGUAGE_INSTRUCTIONS = {
    en: 'Speak ONLY in English. All responses, questions, and transcriptions must be in English.',
    zh: '请只用中文交流。所有回复、问题和转录必须使用中文。',
    hi: 'केवल हिंदी में बोलें। सभी उत्तर, प्रश्न और प्रतिलेखन हिंदी में होने चाहिए।',
    es: 'Habla SOLO en español. Todas las respuestas, preguntas y transcripciones deben estar en español.',
    ar: 'تحدث فقط بالعربية. يجب أن تكون جميع الردود والأسئلة والنصوص بالعربية.',
    bg: 'Говориш САМО на български. Всички отговори, въпроси и транскрипции трябва да са на български.',
  };

  let currentLang = 'bg';

  function getLanguageMeta(code) {
    return SUPPORTED_LANGUAGES.find((l) => l.code === code) || SUPPORTED_LANGUAGES.find((l) => l.code === 'bg');
  }

  function getLanguage() {
    return currentLang;
  }

  function setLanguage(code) {
    const meta = getLanguageMeta(code);
    currentLang = meta.code;
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.rtl ? 'rtl' : 'ltr';
    return meta;
  }

  function t(key, lang) {
    const l = lang || currentLang;
    return STRINGS[l]?.[key] ?? STRINGS.bg[key] ?? key;
  }

  function applyToDocument(root, lang) {
    const l = lang || currentLang;
    setLanguage(l);
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const text = t(key, l);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.hasAttribute('data-i18n-placeholder')) {
          el.placeholder = text;
        }
      } else {
        el.textContent = text;
      }
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'), l);
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'), l));
    });
  }

  function populateLanguageSelect(selectEl, selectedCode) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    for (const lang of SUPPORTED_LANGUAGES) {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = lang.nativeLabel;
      selectEl.appendChild(opt);
    }
    if (selectedCode) selectEl.value = selectedCode;
  }

  function getLanguageInstruction(code) {
    return LANGUAGE_INSTRUCTIONS[code] || LANGUAGE_INSTRUCTIONS.bg;
  }

  function initFromSettings(settings) {
    const lang = settings?.profile?.language || 'bg';
    setLanguage(lang);
    return lang;
  }

  window.AIVA_I18N = {
    SUPPORTED_LANGUAGES,
    STRINGS,
    LANGUAGE_INSTRUCTIONS,
    getLanguage,
    setLanguage,
    getLanguageMeta,
    t,
    applyToDocument,
    populateLanguageSelect,
    getLanguageInstruction,
    initFromSettings,
  };
})();
