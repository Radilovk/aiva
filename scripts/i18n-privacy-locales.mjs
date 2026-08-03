/**
 * Privacy Policy string translations for KASY.
 * Languages: en, bg, zh, hi, es, fr, de, ru, ar  (9 total)
 * 24 keys per language.
 *
 * HTML tags (<strong>, <code>, <a …>) and the Google API URL are preserved
 * verbatim across all translations.
 */

export const PRIVACY_STRINGS = {

  /* ─────────────────────────────────── ENGLISH ──────────────────────────── */
  en: {
    privacyPageTitle: 'Privacy Policy',
    privacyBack: 'Back',
    privacyUpdated: 'Last updated: May 23, 2024',
    privacySec1Title: '1. Overview',
    privacySec1Body:
      'KASY ("the app", "we") is a personal voice assistant for task management. Your privacy is our top priority. This policy explains how we collect, use, and protect your information.',
    privacySec2Title: '2. Data We Collect',
    privacySec2Li1:
      '<strong>Tasks and calendar events:</strong> We store the content of tasks you create so we can display and manage them.',
    privacySec2Li2:
      '<strong>Voice data:</strong> When you use the voice assistant, your audio is sent for transcription and processing to Google Gemini AI models. We do not store your audio recordings long-term.',
    privacySec2Li3:
      '<strong>Technical data:</strong> We use your device\'s local storage (localStorage) to save your personal preferences.',
    privacySec3Title: '3. Use of Google OAuth and Google Data',
    privacySec3Intro:
      'KASY offers integration with Google Calendar. When you choose to connect your Google account:',
    privacySec3Li1:
      '<strong>Access:</strong> The app will request permission to read and write to your Google Calendar (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>Purpose:</strong> We use this access solely to synchronise your tasks with your calendar — to read existing events (to avoid duplicate entries) and to create new events based on the tasks you set in KASY.',
    privacySec3Li3:
      '<strong>Limited Use:</strong> KASY\'s use and transfer of information received from Google APIs to any other application will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Google API Services User Data Policy</a>, including the Limited Use requirements.',
    privacySec3Li4:
      '<strong>Sharing:</strong> Your Google data is not shared with third parties unless strictly necessary to provide app features (e.g. sending text to an AI model for analysis).',
    privacySec4Title: '4. Data Storage',
    privacySec4Body:
      'Your data is stored securely via Cloudflare platforms (D1 and KV) and is encrypted in transit (SSL/TLS).',
    privacySec5Title: '5. Your Rights',
    privacySec5Intro:
      'You have full control over your data. At any time you can:',
    privacySec5Li1: 'Delete all your tasks from the app settings.',
    privacySec5Li2: 'Disconnect your Google account from the "Settings" menu.',
    privacySec5Li3: 'Export your data in JSON format.',
    privacySec6Title: '6. Contact',
    privacySec6Body:
      'If you have questions about this policy, you can reach us through the project\'s GitHub page.',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ──────────────────────────────── BULGARIAN ────────────────────────────── */
  bg: {
    privacyPageTitle: 'Декларация за поверителност',
    privacyBack: 'Назад',
    privacyUpdated: 'Последна актуализация: 23 май 2024 г.',
    privacySec1Title: '1. Обща информация',
    privacySec1Body:
      'KASY ("приложението", "ние") е личен гласов асистент за управление на задачи. Вашата поверителност е наш основен приоритет. Тази декларация обяснява как събираме, използваме и защитаваме вашата информация.',
    privacySec2Title: '2. Събирани данни',
    privacySec2Li1:
      '<strong>Задачи и календарни събития:</strong> Съхраняваме съдържанието на задачите, които създавате, за да можем да ги показваме и управляваме.',
    privacySec2Li2:
      '<strong>Гласови данни:</strong> Когато използвате гласовия асистент, вашето аудио се изпраща за транскрипция и обработка към AI моделите на Google Gemini. Ние не съхраняваме дългосрочно вашите аудио записи.',
    privacySec2Li3:
      '<strong>Технически данни:</strong> Използваме локално хранилище (localStorage) на вашето устройство, за да запазим вашите лични настройки.',
    privacySec3Title: '3. Използване на Google OAuth и данни от Google',
    privacySec3Intro:
      'KASY предлага интеграция с Google Calendar. Когато изберете да свържете вашия Google акаунт:',
    privacySec3Li1:
      '<strong>Достъп:</strong> Приложението ще поиска разрешение за четене и запис във вашия Google Календар (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>Цел:</strong> Използваме този достъп единствено за да синхронизираме вашите задачи с вашия календар – да четем съществуващи събития (за да не се дублират ангажименти) и да създаваме нови събития въз основа на задачите, които поставяте в KASY.',
    privacySec3Li3:
      '<strong>Ограничена употреба (Limited Use):</strong> Използването и трансферът на информация, получена от API на Google, от страна на KASY към всяко друго приложение, ще се придържа към <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Политиката за потребителски данни на услугите на Google API</a>, включително изискванията за ограничена употреба.',
    privacySec3Li4:
      '<strong>Споделяне:</strong> Вашите данни от Google не се споделят с трети страни, освен ако това не е изрично необходимо за предоставяне на функциите на приложението (напр. изпращане на текст към AI модела за анализ).',
    privacySec4Title: '4. Съхранение на данни',
    privacySec4Body:
      'Вашите данни се съхраняват сигурно чрез платформите на Cloudflare (D1 и KV) и се криптират по време на трансфер (SSL/TLS).',
    privacySec5Title: '5. Вашите права',
    privacySec5Intro:
      'Вие имате пълен контрол над вашите данни. Можете по всяко време да:',
    privacySec5Li1: 'Изтриете всички ваши задачи от настройките на приложението.',
    privacySec5Li2: 'Разкачите вашия Google акаунт от менюто "Настройки".',
    privacySec5Li3: 'Експортирате вашите данни в JSON формат.',
    privacySec6Title: '6. Контакт',
    privacySec6Body:
      'Ако имате въпроси относно тази декларация, можете да се свържете с нас чрез GitHub страницата на проекта.',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ──────────────────────────── CHINESE (SIMPLIFIED) ────────────────────── */
  zh: {
    privacyPageTitle: '隐私政策',
    privacyBack: '返回',
    privacyUpdated: '最后更新：2024年5月23日',
    privacySec1Title: '1. 概述',
    privacySec1Body:
      'KASY（"本应用"、"我们"）是一款用于任务管理的个人语音助手。您的隐私是我们的首要任务。本政策说明我们如何收集、使用和保护您的信息。',
    privacySec2Title: '2. 我们收集的数据',
    privacySec2Li1:
      '<strong>任务和日历事件：</strong>我们存储您创建的任务内容，以便显示和管理这些任务。',
    privacySec2Li2:
      '<strong>语音数据：</strong>当您使用语音助手时，您的音频将被发送至 Google Gemini AI 模型进行转录和处理。我们不会长期存储您的音频录音。',
    privacySec2Li3:
      '<strong>技术数据：</strong>我们使用您设备上的本地存储（localStorage）来保存您的个人偏好设置。',
    privacySec3Title: '3. Google OAuth 及 Google 数据的使用',
    privacySec3Intro:
      'KASY 提供与 Google 日历的集成。当您选择关联 Google 账户时：',
    privacySec3Li1:
      '<strong>访问权限：</strong>应用将请求读取和写入您的 Google 日历的权限（<code>https://www.googleapis.com/auth/calendar.events</code>）。',
    privacySec3Li2:
      '<strong>用途：</strong>我们仅将此访问权限用于将您的任务与日历同步——读取现有事件（以避免重复条目）以及根据您在 KASY 中设置的任务创建新事件。',
    privacySec3Li3:
      '<strong>有限使用：</strong>KASY 对从 Google API 获取的信息的使用和传输将遵守 <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Google API 服务用户数据政策</a>，包括有限使用要求。',
    privacySec3Li4:
      '<strong>数据共享：</strong>您的 Google 数据不会与第三方共享，除非严格必要以提供应用功能（例如将文本发送给 AI 模型进行分析）。',
    privacySec4Title: '4. 数据存储',
    privacySec4Body:
      '您的数据通过 Cloudflare 平台（D1 和 KV）安全存储，并在传输过程中加密（SSL/TLS）。',
    privacySec5Title: '5. 您的权利',
    privacySec5Intro: '您对自己的数据拥有完全控制权。您可以随时：',
    privacySec5Li1: '从应用设置中删除所有任务。',
    privacySec5Li2: '从"设置"菜单中断开 Google 账户连接。',
    privacySec5Li3: '以 JSON 格式导出您的数据。',
    privacySec6Title: '6. 联系我们',
    privacySec6Body: '如果您对本政策有任何疑问，请通过项目的 GitHub 页面联系我们。',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ─────────────────────────────────── HINDI ────────────────────────────── */
  hi: {
    privacyPageTitle: 'गोपनीयता नीति',
    privacyBack: 'वापस',
    privacyUpdated: 'अंतिम अपडेट: 23 मई 2024',
    privacySec1Title: '1. सामान्य जानकारी',
    privacySec1Body:
      'KASY ("ऐप", "हम") एक व्यक्तिगत वॉयस असिस्टेंट है जो कार्य प्रबंधन के लिए डिज़ाइन किया गया है। आपकी गोपनीयता हमारी सर्वोच्च प्राथमिकता है। यह नीति बताती है कि हम आपकी जानकारी कैसे एकत्र करते, उपयोग करते और सुरक्षित करते हैं।',
    privacySec2Title: '2. एकत्र किए जाने वाले डेटा',
    privacySec2Li1:
      '<strong>कार्य और कैलेंडर इवेंट:</strong> हम आपके द्वारा बनाए गए कार्यों की सामग्री संग्रहीत करते हैं ताकि उन्हें प्रदर्शित और प्रबंधित किया जा सके।',
    privacySec2Li2:
      '<strong>वॉयस डेटा:</strong> जब आप वॉयस असिस्टेंट का उपयोग करते हैं, तो आपकी ऑडियो को ट्रांसक्रिप्शन और प्रोसेसिंग के लिए Google Gemini AI मॉडल को भेजा जाता है। हम आपकी ऑडियो रिकॉर्डिंग दीर्घकालिक रूप से संग्रहीत नहीं करते।',
    privacySec2Li3:
      '<strong>तकनीकी डेटा:</strong> हम आपकी व्यक्तिगत प्राथमिकताएँ सहेजने के लिए आपके डिवाइस के स्थानीय स्टोरेज (localStorage) का उपयोग करते हैं।',
    privacySec3Title: '3. Google OAuth और Google डेटा का उपयोग',
    privacySec3Intro:
      'KASY Google Calendar के साथ एकीकरण प्रदान करता है। जब आप अपना Google खाता कनेक्ट करना चुनते हैं:',
    privacySec3Li1:
      '<strong>पहुँच:</strong> ऐप आपके Google Calendar को पढ़ने और लिखने की अनुमति माँगेगा (<code>https://www.googleapis.com/auth/calendar.events</code>)।',
    privacySec3Li2:
      '<strong>उद्देश्य:</strong> हम इस पहुँच का उपयोग केवल आपके कार्यों को आपके कैलेंडर से सिंक्रनाइज़ करने के लिए करते हैं — मौजूदा इवेंट पढ़ने (डुप्लीकेट से बचने) और KASY में सेट किए गए कार्यों के आधार पर नए इवेंट बनाने के लिए।',
    privacySec3Li3:
      '<strong>सीमित उपयोग:</strong> Google API से प्राप्त जानकारी का KASY द्वारा उपयोग और हस्तांतरण <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Google API सेवाओं की उपयोगकर्ता डेटा नीति</a> का पालन करेगा, जिसमें सीमित उपयोग की आवश्यकताएँ शामिल हैं।',
    privacySec3Li4:
      '<strong>साझाकरण:</strong> आपका Google डेटा तृतीय पक्षों के साथ साझा नहीं किया जाता, जब तक कि ऐप की सुविधाएँ प्रदान करने के लिए यह अत्यंत आवश्यक न हो (जैसे विश्लेषण के लिए AI मॉडल को टेक्स्ट भेजना)।',
    privacySec4Title: '4. डेटा संग्रहण',
    privacySec4Body:
      'आपका डेटा Cloudflare प्लेटफ़ॉर्म (D1 और KV) के माध्यम से सुरक्षित रूप से संग्रहीत किया जाता है और ट्रांसमिशन के दौरान एन्क्रिप्ट किया जाता है (SSL/TLS)।',
    privacySec5Title: '5. आपके अधिकार',
    privacySec5Intro: 'आपके पास अपने डेटा पर पूर्ण नियंत्रण है। आप किसी भी समय:',
    privacySec5Li1: 'ऐप सेटिंग्स से अपने सभी कार्य हटा सकते हैं।',
    privacySec5Li2: '"सेटिंग्स" मेनू से अपना Google खाता डिस्कनेक्ट कर सकते हैं।',
    privacySec5Li3: 'अपना डेटा JSON फ़ॉर्मेट में एक्सपोर्ट कर सकते हैं।',
    privacySec6Title: '6. संपर्क',
    privacySec6Body:
      'यदि इस नीति के बारे में आपके कोई प्रश्न हैं, तो आप प्रोजेक्ट के GitHub पृष्ठ के माध्यम से हमसे संपर्क कर सकते हैं।',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ─────────────────────────────────── SPANISH ──────────────────────────── */
  es: {
    privacyPageTitle: 'Política de privacidad',
    privacyBack: 'Volver',
    privacyUpdated: 'Última actualización: 23 de mayo de 2024',
    privacySec1Title: '1. Información general',
    privacySec1Body:
      'KASY ("la aplicación", "nosotros") es un asistente de voz personal para la gestión de tareas. Tu privacidad es nuestra máxima prioridad. Esta política explica cómo recopilamos, utilizamos y protegemos tu información.',
    privacySec2Title: '2. Datos que recopilamos',
    privacySec2Li1:
      '<strong>Tareas y eventos de calendario:</strong> Almacenamos el contenido de las tareas que creas para poder mostrarlas y gestionarlas.',
    privacySec2Li2:
      '<strong>Datos de voz:</strong> Cuando utilizas el asistente de voz, tu audio se envía para su transcripción y procesamiento a los modelos de IA de Google Gemini. No almacenamos tus grabaciones de audio a largo plazo.',
    privacySec2Li3:
      '<strong>Datos técnicos:</strong> Utilizamos el almacenamiento local (localStorage) de tu dispositivo para guardar tus preferencias personales.',
    privacySec3Title: '3. Uso de Google OAuth y datos de Google',
    privacySec3Intro:
      'KASY ofrece integración con Google Calendar. Cuando eliges conectar tu cuenta de Google:',
    privacySec3Li1:
      '<strong>Acceso:</strong> La aplicación solicitará permiso para leer y escribir en tu Google Calendar (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>Finalidad:</strong> Utilizamos este acceso únicamente para sincronizar tus tareas con tu calendario: leer eventos existentes (para evitar duplicados) y crear nuevos eventos basados en las tareas que estableces en KASY.',
    privacySec3Li3:
      '<strong>Uso limitado:</strong> El uso y la transferencia de información obtenida de las API de Google por parte de KASY a cualquier otra aplicación se ajustará a la <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Política de datos de usuario de los servicios de la API de Google</a>, incluidos los requisitos de uso limitado.',
    privacySec3Li4:
      '<strong>Compartición:</strong> Tus datos de Google no se comparten con terceros salvo que sea estrictamente necesario para proporcionar las funciones de la aplicación (p. ej., enviar texto a un modelo de IA para su análisis).',
    privacySec4Title: '4. Almacenamiento de datos',
    privacySec4Body:
      'Tus datos se almacenan de forma segura a través de las plataformas de Cloudflare (D1 y KV) y se cifran durante la transmisión (SSL/TLS).',
    privacySec5Title: '5. Tus derechos',
    privacySec5Intro:
      'Tienes control total sobre tus datos. En cualquier momento puedes:',
    privacySec5Li1: 'Eliminar todas tus tareas desde la configuración de la aplicación.',
    privacySec5Li2: 'Desconectar tu cuenta de Google desde el menú "Configuración".',
    privacySec5Li3: 'Exportar tus datos en formato JSON.',
    privacySec6Title: '6. Contacto',
    privacySec6Body:
      'Si tienes preguntas sobre esta política, puedes contactarnos a través de la página de GitHub del proyecto.',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ─────────────────────────────────── FRENCH ───────────────────────────── */
  fr: {
    privacyPageTitle: 'Politique de confidentialité',
    privacyBack: 'Retour',
    privacyUpdated: 'Dernière mise à jour : 23 mai 2024',
    privacySec1Title: '1. Informations générales',
    privacySec1Body:
      'KASY (« l\'application », « nous ») est un assistant vocal personnel dédié à la gestion des tâches. Votre confidentialité est notre priorité absolue. Cette politique explique comment nous collectons, utilisons et protégeons vos informations.',
    privacySec2Title: '2. Données collectées',
    privacySec2Li1:
      '<strong>Tâches et événements de calendrier :</strong> Nous stockons le contenu des tâches que vous créez afin de pouvoir les afficher et les gérer.',
    privacySec2Li2:
      '<strong>Données vocales :</strong> Lorsque vous utilisez l\'assistant vocal, votre audio est envoyé pour transcription et traitement aux modèles d\'IA Google Gemini. Nous ne conservons pas vos enregistrements audio à long terme.',
    privacySec2Li3:
      '<strong>Données techniques :</strong> Nous utilisons le stockage local (localStorage) de votre appareil pour enregistrer vos préférences personnelles.',
    privacySec3Title: '3. Utilisation de Google OAuth et des données Google',
    privacySec3Intro:
      'KASY propose une intégration avec Google Agenda. Lorsque vous choisissez de connecter votre compte Google :',
    privacySec3Li1:
      '<strong>Accès :</strong> L\'application demandera l\'autorisation de lire et d\'écrire dans votre Google Agenda (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>Finalité :</strong> Nous utilisons cet accès uniquement pour synchroniser vos tâches avec votre agenda — lire les événements existants (pour éviter les doublons) et créer de nouveaux événements basés sur les tâches que vous définissez dans KASY.',
    privacySec3Li3:
      '<strong>Utilisation limitée :</strong> L\'utilisation et le transfert par KASY des informations reçues des API Google vers toute autre application seront conformes à la <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Politique relative aux données des utilisateurs des services de l\'API Google</a>, y compris les exigences d\'utilisation limitée.',
    privacySec3Li4:
      '<strong>Partage :</strong> Vos données Google ne sont pas partagées avec des tiers, sauf si cela est strictement nécessaire pour fournir les fonctionnalités de l\'application (p. ex. envoi de texte à un modèle d\'IA pour analyse).',
    privacySec4Title: '4. Stockage des données',
    privacySec4Body:
      'Vos données sont stockées de manière sécurisée via les plateformes Cloudflare (D1 et KV) et sont chiffrées lors du transfert (SSL/TLS).',
    privacySec5Title: '5. Vos droits',
    privacySec5Intro:
      'Vous avez un contrôle total sur vos données. Vous pouvez à tout moment :',
    privacySec5Li1: 'Supprimer toutes vos tâches depuis les paramètres de l\'application.',
    privacySec5Li2: 'Déconnecter votre compte Google depuis le menu « Paramètres ».',
    privacySec5Li3: 'Exporter vos données au format JSON.',
    privacySec6Title: '6. Contact',
    privacySec6Body:
      'Si vous avez des questions concernant cette politique, vous pouvez nous contacter via la page GitHub du projet.',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ─────────────────────────────────── GERMAN ───────────────────────────── */
  de: {
    privacyPageTitle: 'Datenschutzerklärung',
    privacyBack: 'Zurück',
    privacyUpdated: 'Zuletzt aktualisiert: 23. Mai 2024',
    privacySec1Title: '1. Allgemeine Informationen',
    privacySec1Body:
      'KASY („die App", „wir") ist ein persönlicher Sprachassistent zur Aufgabenverwaltung. Ihre Privatsphäre hat für uns höchste Priorität. Diese Erklärung erläutert, wie wir Ihre Daten erheben, verwenden und schützen.',
    privacySec2Title: '2. Erhobene Daten',
    privacySec2Li1:
      '<strong>Aufgaben und Kalendereinträge:</strong> Wir speichern den Inhalt der von Ihnen erstellten Aufgaben, um diese anzeigen und verwalten zu können.',
    privacySec2Li2:
      '<strong>Sprachdaten:</strong> Wenn Sie den Sprachassistenten verwenden, wird Ihre Audioeingabe zur Transkription und Verarbeitung an die KI-Modelle von Google Gemini übermittelt. Wir speichern Ihre Audioaufnahmen nicht dauerhaft.',
    privacySec2Li3:
      '<strong>Technische Daten:</strong> Wir verwenden den lokalen Speicher (localStorage) Ihres Geräts, um Ihre persönlichen Einstellungen zu speichern.',
    privacySec3Title: '3. Verwendung von Google OAuth und Google-Daten',
    privacySec3Intro:
      'KASY bietet eine Integration mit Google Kalender an. Wenn Sie Ihr Google-Konto verknüpfen möchten:',
    privacySec3Li1:
      '<strong>Zugriff:</strong> Die App fordert die Berechtigung an, Ihren Google Kalender zu lesen und zu schreiben (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>Zweck:</strong> Wir nutzen diesen Zugriff ausschließlich zur Synchronisierung Ihrer Aufgaben mit Ihrem Kalender — zum Lesen vorhandener Termine (zur Vermeidung von Duplikaten) und zum Erstellen neuer Einträge auf Basis der in KASY gesetzten Aufgaben.',
    privacySec3Li3:
      '<strong>Eingeschränkte Nutzung:</strong> Die Verwendung und Weitergabe von Informationen, die KASY über Google APIs erhält, an andere Anwendungen erfolgt in Übereinstimmung mit der <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Richtlinie für Nutzerdaten der Google API-Dienste</a>, einschließlich der Anforderungen zur eingeschränkten Nutzung.',
    privacySec3Li4:
      '<strong>Weitergabe:</strong> Ihre Google-Daten werden nicht an Dritte weitergegeben, es sei denn, dies ist für die Bereitstellung der App-Funktionen unbedingt erforderlich (z. B. Übermittlung von Text an ein KI-Modell zur Analyse).',
    privacySec4Title: '4. Datenspeicherung',
    privacySec4Body:
      'Ihre Daten werden sicher über die Cloudflare-Plattformen (D1 und KV) gespeichert und während der Übertragung verschlüsselt (SSL/TLS).',
    privacySec5Title: '5. Ihre Rechte',
    privacySec5Intro:
      'Sie haben die vollständige Kontrolle über Ihre Daten. Sie können jederzeit:',
    privacySec5Li1: 'Alle Ihre Aufgaben in den App-Einstellungen löschen.',
    privacySec5Li2: 'Ihr Google-Konto im Menü „Einstellungen" trennen.',
    privacySec5Li3: 'Ihre Daten im JSON-Format exportieren.',
    privacySec6Title: '6. Kontakt',
    privacySec6Body:
      'Wenn Sie Fragen zu dieser Erklärung haben, können Sie uns über die GitHub-Seite des Projekts erreichen.',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ─────────────────────────────────── RUSSIAN ──────────────────────────── */
  ru: {
    privacyPageTitle: 'Политика конфиденциальности',
    privacyBack: 'Назад',
    privacyUpdated: 'Последнее обновление: 23 мая 2024 г.',
    privacySec1Title: '1. Общая информация',
    privacySec1Body:
      'KASY («приложение», «мы») — персональный голосовой ассистент для управления задачами. Ваша конфиденциальность является нашим главным приоритетом. Настоящая политика объясняет, как мы собираем, используем и защищаем вашу информацию.',
    privacySec2Title: '2. Собираемые данные',
    privacySec2Li1:
      '<strong>Задачи и события календаря:</strong> Мы храним содержимое задач, которые вы создаёте, чтобы иметь возможность их отображать и управлять ими.',
    privacySec2Li2:
      '<strong>Голосовые данные:</strong> При использовании голосового ассистента ваш аудиосигнал передаётся для транскрипции и обработки в модели ИИ Google Gemini. Мы не храним ваши аудиозаписи на долгосрочной основе.',
    privacySec2Li3:
      '<strong>Технические данные:</strong> Мы используем локальное хранилище (localStorage) вашего устройства для сохранения ваших личных настроек.',
    privacySec3Title: '3. Использование Google OAuth и данных Google',
    privacySec3Intro:
      'KASY предлагает интеграцию с Google Календарём. Когда вы выбираете подключение аккаунта Google:',
    privacySec3Li1:
      '<strong>Доступ:</strong> Приложение запросит разрешение на чтение и запись в вашем Google Календаре (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>Цель:</strong> Мы используем этот доступ исключительно для синхронизации ваших задач с календарём — чтения существующих событий (во избежание дублирования) и создания новых событий на основе задач, установленных в KASY.',
    privacySec3Li3:
      '<strong>Ограниченное использование:</strong> Использование и передача информации, полученной от API Google, приложением KASY любому другому приложению будут соответствовать <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">Политике использования данных пользователей сервисов Google API</a>, включая требования об ограниченном использовании.',
    privacySec3Li4:
      '<strong>Передача данных:</strong> Ваши данные Google не передаются третьим сторонам, кроме случаев, когда это строго необходимо для предоставления функций приложения (например, отправка текста в модель ИИ для анализа).',
    privacySec4Title: '4. Хранение данных',
    privacySec4Body:
      'Ваши данные надёжно хранятся на платформах Cloudflare (D1 и KV) и шифруются при передаче (SSL/TLS).',
    privacySec5Title: '5. Ваши права',
    privacySec5Intro:
      'Вы полностью контролируете свои данные. В любое время вы можете:',
    privacySec5Li1: 'Удалить все свои задачи в настройках приложения.',
    privacySec5Li2: 'Отключить аккаунт Google в меню «Настройки».',
    privacySec5Li3: 'Экспортировать свои данные в формате JSON.',
    privacySec6Title: '6. Контакты',
    privacySec6Body:
      'Если у вас возникли вопросы относительно данной политики, вы можете связаться с нами через страницу проекта на GitHub.',
    privacyFooter: '© 2024 KASY Assistant',
  },

  /* ─────────────────────────────────── ARABIC ───────────────────────────── */
  ar: {
    privacyPageTitle: 'سياسة الخصوصية',
    privacyBack: 'رجوع',
    privacyUpdated: 'آخر تحديث: 23 مايو 2024',
    privacySec1Title: '1. معلومات عامة',
    privacySec1Body:
      'KASY ("التطبيق"، "نحن") مساعد صوتي شخصي لإدارة المهام. تُعدّ خصوصيتك أولويتنا القصوى. توضح هذه السياسة كيفية جمعنا لمعلوماتك واستخدامها وحمايتها.',
    privacySec2Title: '2. البيانات التي نجمعها',
    privacySec2Li1:
      '<strong>المهام وأحداث التقويم:</strong> نحتفظ بمحتوى المهام التي تنشئها لنتمكن من عرضها وإدارتها.',
    privacySec2Li2:
      '<strong>بيانات الصوت:</strong> عند استخدام المساعد الصوتي، يُرسَل صوتك إلى نماذج الذكاء الاصطناعي Google Gemini للنسخ والمعالجة. لا نحتفظ بتسجيلاتك الصوتية على المدى الطويل.',
    privacySec2Li3:
      '<strong>البيانات التقنية:</strong> نستخدم التخزين المحلي (localStorage) في جهازك لحفظ تفضيلاتك الشخصية.',
    privacySec3Title: '3. استخدام Google OAuth وبيانات Google',
    privacySec3Intro:
      'يوفر تطبيق KASY تكاملاً مع Google Calendar. عند اختيارك ربط حساب Google الخاص بك:',
    privacySec3Li1:
      '<strong>الوصول:</strong> سيطلب التطبيق إذناً لقراءة تقويم Google الخاص بك والكتابة فيه (<code>https://www.googleapis.com/auth/calendar.events</code>).',
    privacySec3Li2:
      '<strong>الغرض:</strong> نستخدم هذا الوصول حصراً لمزامنة مهامك مع تقويمك — لقراءة الأحداث الموجودة (تفادياً للتكرار) وإنشاء أحداث جديدة بناءً على المهام التي تحددها في KASY.',
    privacySec3Li3:
      '<strong>الاستخدام المحدود:</strong> سيلتزم استخدام KASY ونقل المعلومات الواردة من واجهات برمجة تطبيقات Google إلى أي تطبيق آخر بـ<a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" style="color:var(--accent)">سياسة بيانات المستخدم لخدمات Google API</a>، بما في ذلك متطلبات الاستخدام المحدود.',
    privacySec3Li4:
      '<strong>المشاركة:</strong> لا تُشارَك بيانات Google الخاصة بك مع أطراف ثالثة إلا إذا كان ذلك ضرورياً تماماً لتوفير ميزات التطبيق (مثل إرسال نص إلى نموذج ذكاء اصطناعي للتحليل).',
    privacySec4Title: '4. تخزين البيانات',
    privacySec4Body:
      'تُخزَّن بياناتك بأمان عبر منصات Cloudflare (D1 وKV) وتُشفَّر أثناء النقل (SSL/TLS).',
    privacySec5Title: '5. حقوقك',
    privacySec5Intro: 'لديك تحكم كامل في بياناتك. يمكنك في أي وقت:',
    privacySec5Li1: 'حذف جميع مهامك من إعدادات التطبيق.',
    privacySec5Li2: 'قطع ارتباط حساب Google من قائمة "الإعدادات".',
    privacySec5Li3: 'تصدير بياناتك بتنسيق JSON.',
    privacySec6Title: '6. التواصل معنا',
    privacySec6Body:
      'إذا كانت لديك أسئلة حول هذه السياسة، يمكنك التواصل معنا عبر صفحة المشروع على GitHub.',
    privacyFooter: '© 2024 KASY Assistant',
  },

};
