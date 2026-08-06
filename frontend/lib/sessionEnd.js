/**
 * Session end detection + localized end_session instructions + device clock context.
 */
(function () {
  const ASSISTANT_FAREWELL_PATTERNS = [
    // Bulgarian
    /оставам\s+на\s+разположение/i,
    /до\s+скоро/i,
    /приятен\s+ден/i,
    /приятна\s+(вечер|сутрин|седмица|нощ)/i,
    /довиждане/i,
    /лек\s+ден/i,
    /\bчао\b/i,
    // English
    /i\s*['']?m\s+here\s+if\s+you\s+need/i,
    /see\s+you\s+(soon|later)/i,
    /have\s+a\s+(nice|good|great)\s+(day|evening|night|weekend)/i,
    /\bgood\s*bye\b/i,
    /\bbye\b[!.]?\s*$/i,
    // Spanish
    /hasta\s+(luego|pronto)/i,
    /que\s+tengas\s+un\s+buen/i,
    /adi[oó]s/i,
    // French
    /au\s+revoir/i,
    /[àa]\s+bient[oô]t/i,
    /bonne\s+journ[eé]e/i,
    /bonne\s+soir[eé]e/i,
    // German
    /auf\s+wiedersehen/i,
    /bis\s+(bald|sp[aä]ter)/i,
    /sch[oö]nen\s+tag/i,
    /tsch[uü]ss/i,
    // Russian
    /до\s+свидания/i,
    /до\s+скорой/i,
    /всего\s+доброго/i,
    /я\s+на\s+связи/i,
    /буду\s+на\s+связи/i,
    // Hindi
    /अलविदा/,
    /फिर\s+मिलेंगे/,
    /शुभ\s+रात्रि/,
    // Chinese
    /再见/,
    /再会/,
    /有需要.*联系/,
    // Arabic
    /مع\s*السلامة/,
    /إلى\s+اللقاء/,
    /في\s+أمان\s+الله/,
  ];

  const USER_GOODBYE_PATTERNS = [
    // Bulgarian
    /\b(чао|довиждане|край|стоп|затвори|спри|достатъчно|готово)\b/i,
    /благодаря[,.\s]*(това\s+е|достатъчно|супер)?/i,
    /не\s+благодаря/i,
    /\bнищо\b/i,
    // English
    /\b(bye|goodbye|stop|close|done|that'?s all|nothing else|no thanks)\b/i,
    // Spanish
    /\b(adi[oó]s|chao|gracias|nada m[aá]s|listo)\b/i,
    // French
    /\b(au revoir|merci|c'?est tout|rien)\b/i,
    // German
    /\b(tsch[uü]ss|auf wiedersehen|danke|das war'?s|fertig)\b/i,
    // Russian
    /\b(пока|до свидания|спасибо|всё|хватит)\b/i,
    // Hindi
    /(अलविदा|धन्यवाद|बस|ठीक है)/,
    // Chinese
    /(再见|谢谢|够了|没有了)/,
    // Arabic
    /(مع السلامة|شكرا|لا شيء|كفى)/,
  ];

  const SESSION_END_TEMPLATES = {
    bg: `КРАЙ НА РАЗГОВОРА (КРИТИЧНО):
Единствено ти прекратяваш сесията с инструмента end_session. Клиентът също следи сбогуванията — ако кажеш „чао", „до скоро", „оставам на разположение" и подобни БЕЗ end_session, сесията пак ще спре, но винаги извиквай end_session в същия ход.

Разговорът е приключил, когато:
- потребителят се сбогува („чао", „довиждане", „край", „стоп", „благодаря, това е" и подобни), ИЛИ
- след заявка си попитал „{askAnything}" и потребителят отказа („не", „нищо", „готово")

В ЕДИН ход: (1) кратко сбогуване на езика на потребителя, (2) ВЕДНАГА end_session.
Не споменавай „сесия" или „затваряне". След end_session — тишина.`,

    en: `END OF CONVERSATION (CRITICAL):
Only you end the session via end_session. The client also watches farewell phrases — if you say "bye", "see you soon", "I'm here if you need" etc. WITHOUT end_session, the session still closes, but ALWAYS call end_session in the same turn.

The conversation is over when:
- the user says goodbye ("bye", "goodbye", "stop", "that's all", "thanks, that's it"), OR
- after a request you asked "{askAnything}" and they declined ("no", "nothing", "done")

In ONE turn: (1) brief farewell in the user's language, (2) IMMEDIATELY end_session.
Never mention "session" or "closing". After end_session — silence.`,

    es: `FIN DE CONVERSACIÓN (CRÍTICO):
Solo tú terminas la sesión con end_session. El cliente también detecta despedidas — si dices "adiós", "hasta pronto", etc. SIN end_session, la sesión igual se cierra, pero SIEMPRE llama end_session en el mismo turno.

La conversación termina cuando:
- el usuario se despide ("adiós", "chao", "gracias, eso es todo", "para"), O
- tras una petición preguntaste "{askAnything}" y rechazó ("no", "nada", "listo")

En UN turno: (1) despedida breve en el idioma del usuario, (2) INMEDIATAMENTE end_session.
No menciones "sesión" ni "cerrar". Tras end_session — silencio.`,

    fr: `FIN DE CONVERSATION (CRITIQUE):
Seul end_session termine la session. Le client détecte aussi les adieux — si tu dis "au revoir", "à bientôt", etc. SANS end_session, la session se ferme quand même, mais appelle TOUJOURS end_session dans le même tour.

La conversation est terminée quand:
- l'utilisateur dit au revoir ("au revoir", "bye", "merci, c'est tout", "stop"), OU
- après une demande tu as demandé "{askAnything}" et il a refusé ("non", "rien", "c'est bon")

En UN tour: (1) court adieu dans la langue de l'utilisateur, (2) IMMÉDIATEMENT end_session.
Ne mentionne pas "session" ni "fermeture". Après end_session — silence.`,

    de: `GESPRÄCHSENDE (KRITISCH):
Nur end_session beendet die Sitzung. Der Client erkennt auch Verabschiedungen — wenn du "Tschüss", "bis bald" usw. sagst OHNE end_session, schließt die Sitzung trotzdem, aber rufe IMMER end_session im selben Turn auf.

Das Gespräch ist zu Ende, wenn:
- der Nutzer sich verabschiedet ("Tschüss", "Auf Wiedersehen", "Stopp", "danke, das war's"), ODER
- nach einer Anfrage du "{askAnything}" gefragt hast und er ablehnt ("nein", "nichts", "fertig")

In EINEM Turn: (1) kurze Verabschiedung in der Sprache des Nutzers, (2) SOFORT end_session.
Erwähne nie "Sitzung" oder "Schließen". Nach end_session — Stille.`,

    ru: `КОНЕЦ РАЗГОВОРА (КРИТИЧНО):
Только end_session завершает сессию. Клиент также отслеживает прощания — если скажешь «до свидания», «до скорой» и т.п. БЕЗ end_session, сессия всё равно закроется, но ВСЕГДА вызывай end_session в том же ходе.

Разговор окончен, когда:
- пользователь прощается («пока», «до свидания», «стоп», «спасибо, всё»), ИЛИ
- после запроса ты спросил «{askAnything}» и он отказался («нет», «ничего», «готово»)

В ОДНОМ ходе: (1) краткое прощание на языке пользователя, (2) СРАЗУ end_session.
Не упоминай «сессию» или «закрытие». После end_session — тишина.`,

    hi: `बातचीत समाप्त (महत्वपूर्ण):
केवल end_session सत्र समाप्त करता है। क्लाइंट अलविदा भी पहचानता है — यदि आप "अलविदा", "फिर मिलेंगे" आदि कहें बिना end_session के, सत्र फिर भी बंद होगा, पर हमेशा उसी टर्न में end_session कॉल करें।

बातचीत समाप्त जब:
- उपयोगकर्ता अलविदा कहे, या
- अनुरोध के बाद आपने "{askAnything}" पूछा और उन्होंने मना किया ("नहीं", "कुछ नहीं")

एक टर्न में: (1) संक्षिप्त विदाई, (2) तुरंत end_session।`,

    zh: `对话结束（关键）：
只有 end_session 能结束会话。客户端也会检测告别语——若你说「再见」「有需要再联系」等但未调用 end_session，会话仍会关闭，但务必在同一轮调用 end_session。

对话结束当：
- 用户告别（「再见」「谢谢够了」「停止」），或
- 完成请求后你问了「{askAnything}」且用户拒绝（「不用」「没有了」）

同一轮：(1) 简短告别，(2) 立即 end_session。`,

    ar: `نهاية المحادثة (حرج):
فقط end_session ينهي الجلسة. العميل يكتشف التوديع أيضاً — إن قلت «مع السلامة» ونحوها دون end_session، ستُغلق الجلسة، لكن استدعِ end_session دائماً في نفس الدور.

تنتهي المحادثة عندما:
- يودع المستخدم، أو
- بعد طلب سألت «{askAnything}» ورفض («لا»، «لا شيء»)

في دور واحد: (1) وداع قصير، (2) فوراً end_session.`,
  };

  const END_SESSION_TOOL_DESC = {
    bg: 'Спира слушането и затваря гласовата сесия. ЗАДЪЛЖИТЕЛНО го извикай в същия ход веднага след сбогуването.',
    en: 'Stops listening and closes the voice session. REQUIRED: call immediately after your farewell in the same turn.',
    es: 'Detiene la escucha y cierra la sesión de voz. OBLIGATORIO: llámalo inmediatamente tras la despedida en el mismo turno.',
    fr: 'Arrête l\'écoute et ferme la session vocale. OBLIGATOIRE : appelle immédiatement après l\'adieu dans le même tour.',
    de: 'Beendet das Zuhören und schließt die Sprachsitzung. PFLICHT: sofort nach der Verabschiedung im selben Turn aufrufen.',
    ru: 'Останавливает прослушивание и закрывает голосовую сессию. ОБЯЗАТЕЛЬНО вызови сразу после прощания в том же ходе.',
    hi: 'सुनना बंद करके वॉयस सत्र बंद करता है। अनिवार्य: विदाई के तुरंत बाद उसी टर्न में कॉल करें।',
    zh: '停止聆听并关闭语音会话。必须：在同一轮告别后立即调用。',
    ar: 'يوقف الاستماع ويغلق جلسة الصوت. إلزامي: استدعِه فور الوداع في نفس الدور.',
  };

  const DATETIME_CONTEXT = {
    bg: `ТЕКУЩО ВРЕМЕ НА ТЕЛЕФОНА (източник на истина):
- Локално: {datetime}
- Часова зона: {timezone}
- Дата: {isoDate}, час: {isoTime}
Винаги използвай това за „сега", „днес", „утре", напомняния (device_schedule_reminder) и будилници. Не използвай UTC или предположения.`,
    en: `DEVICE CURRENT TIME (source of truth):
- Local: {datetime}
- Timezone: {timezone}
- Date: {isoDate}, time: {isoTime}
Always use this for "now", "today", "tomorrow", reminders (device_schedule_reminder) and alarms. Do not guess UTC.`,
    es: `HORA ACTUAL DEL DISPOSITIVO (fuente de verdad):
- Local: {datetime}
- Zona horaria: {timezone}
- Fecha: {isoDate}, hora: {isoTime}
Usa siempre esto para "ahora", "hoy", "mañana", recordatorios y alarmas. No uses UTC.`,
    fr: `HEURE ACTUELLE DE L'APPAREIL (référence):
- Local : {datetime}
- Fuseau : {timezone}
- Date : {isoDate}, heure : {isoTime}
Utilise toujours ceci pour « maintenant », « aujourd'hui », rappels et alarmes.`,
    de: `AKTUELLE GERÄTEZEIT (maßgeblich):
- Lokal: {datetime}
- Zeitzone: {timezone}
- Datum: {isoDate}, Uhrzeit: {isoTime}
Immer für „jetzt", „heute", Erinnerungen und Wecker verwenden.`,
    ru: `ТЕКУЩЕЕ ВРЕМЯ УСТРОЙСТВА (источник истины):
- Локально: {datetime}
- Часовой пояс: {timezone}
- Дата: {isoDate}, время: {isoTime}
Всегда используй для «сейчас», «сегодня», напоминаний и будильников.`,
    hi: `डिवाइस का वर्तमान समय:
- स्थानीय: {datetime}
- समय क्षेत्र: {timezone}
- तारीख: {isoDate}, समय: {isoTime}
"अभी", "आज", रिमाइंडर के लिए हमेशा इसका उपयोग करें।`,
    zh: `设备当前时间（权威）：
- 本地：{datetime}
- 时区：{timezone}
- 日期：{isoDate}，时间：{isoTime}
“现在”“今天”“明天”及提醒、闹钟均以此为准。`,
    ar: `الوقت الحالي للجهاز:
- محلي: {datetime}
- المنطقة: {timezone}
- التاريخ: {isoDate}، الوقت: {isoTime}
استخدم دائماً لـ «الآن» والتذكيرات والمنبهات.`,
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function looksLikeAssistantFarewell(text) {
    const t = normalizeText(text);
    if (!t || t.length < 3) return false;
    return ASSISTANT_FAREWELL_PATTERNS.some((re) => re.test(t));
  }

  function looksLikeUserGoodbye(text) {
    const t = normalizeText(text);
    if (!t || t.length < 2) return false;
    if (/^(чао|край|стоп|довиждане|bye|goodbye|ciao|chao|adi[oó]s|пока)$/i.test(t)) {
      return true;
    }
    return USER_GOODBYE_PATTERNS.some((re) => re.test(t));
  }

  function getSessionEndInstructions(lang) {
    const code = lang || 'bg';
    const ask = window.AIVA_I18N?.t?.('askAnything', code)
      || window.AIVA_I18N?.t?.('askAnything', 'en')
      || 'Do you need anything else?';
    const template = SESSION_END_TEMPLATES[code] || SESSION_END_TEMPLATES.en;
    return template.replace(/\{askAnything\}/g, ask);
  }

  function getEndSessionToolDescription(lang) {
    const code = lang || 'bg';
    return END_SESSION_TOOL_DESC[code] || END_SESSION_TOOL_DESC.en;
  }

  function buildDeviceDateTimeContext(lang) {
    const code = lang || 'bg';
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const loc = window.AIVA_I18N?.getLocale?.(code) || code;
    let formatted;
    try {
      formatted = new Intl.DateTimeFormat(loc, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }).format(now);
    } catch (_e) {
      formatted = now.toString();
    }
    const isoDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const isoTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const template = DATETIME_CONTEXT[code] || DATETIME_CONTEXT.en;
    return template
      .replace(/\{datetime\}/g, formatted)
      .replace(/\{timezone\}/g, tz)
      .replace(/\{isoDate\}/g, isoDate)
      .replace(/\{isoTime\}/g, isoTime);
  }

  window.AIVA_SESSION_END = {
    looksLikeAssistantFarewell,
    looksLikeUserGoodbye,
    getSessionEndInstructions,
    getEndSessionToolDescription,
    buildDeviceDateTimeContext,
  };
})();
