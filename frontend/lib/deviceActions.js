/**
 * Device Actions — reliable phone interactions via Android intents (APK)
 * or web fallbacks (PWA). No UI automation; user confirms sends/calls in
 * the target app where required.
 */
(function () {
  const APP_CATALOG = {
    viber: { packageName: 'com.viber.voip', label: 'Viber' },
    whatsapp: { packageName: 'com.whatsapp', label: 'WhatsApp' },
    telegram: { packageName: 'org.telegram.messenger', label: 'Telegram' },
    gmail: { packageName: 'com.google.android.gm', label: 'Gmail' },
    maps: { packageName: 'com.google.android.apps.maps', label: 'Google Maps' },
    waze: { packageName: 'com.waze', label: 'Waze' },
    chrome: { packageName: 'com.android.chrome', label: 'Chrome' },
    camera: { packageName: 'com.android.camera2', label: 'Camera' },
    settings: { packageName: 'android.settings.SETTINGS', label: 'Settings', isAction: true },
  };

  const ACTION_LABELS = {
    navigate: 'Навигация',
    open_app: 'Отваряне на приложение',
    open_url: 'Отваряне на линк',
    share_text: 'Споделяне на текст',
    dial_number: 'Обаждане',
    compose_sms: 'SMS чернова',
    set_alarm: 'Будилник',
    copy_text: 'Копиране',
    open_settings: 'Системни настройки',
    search_maps: 'Търсене в карти',
    find_contacts: 'Търсене в контакти',
    schedule_reminder: 'Напомняне',
  };

  function getPlugin() {
    return window.Capacitor?.Plugins?.AivaActions
      || window.Capacitor?.registerPlugin?.('AivaActions');
  }

  function isNativeAndroid() {
    return window.Capacitor?.getPlatform?.() === 'android';
  }

  function isEnabled() {
    const settings = window.AIVA_SETTINGS?.loadAssistantSettings?.();
    return settings?.deviceActions?.enabled !== false;
  }

  async function nativeCall(method, payload) {
    const plugin = getPlugin();
    if (!plugin?.[method]) {
      return { ok: false, error: 'native_plugin_unavailable' };
    }
    try {
      return await plugin[method](payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  function resolveAppId(appId) {
    const key = String(appId || '').trim().toLowerCase();
    if (!key) return null;
    if (APP_CATALOG[key]) return APP_CATALOG[key];
    if (key.includes('.')) return { packageName: key, label: key };
    return null;
  }

  async function navigate(destination, mode = 'drive') {
    const dest = String(destination || '').trim();
    if (!dest) return { ok: false, error: 'destination required' };

    if (isNativeAndroid()) {
      return nativeCall('navigateTo', { destination: dest, mode });
    }

    const encoded = encodeURIComponent(dest);
    const travel = mode === 'walk' ? 'walking' : 'driving';
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=${travel}`,
      '_blank',
      'noopener'
    );
    return { ok: true, method: 'web_maps' };
  }

  async function openApp(appId) {
    const app = resolveAppId(appId);
    if (!app) return { ok: false, error: `unknown app: ${appId}` };

    if (isNativeAndroid()) {
      if (app.isAction) {
        return nativeCall('openSystemSettings', { panel: 'main' });
      }
      return nativeCall('openApp', { packageName: app.packageName });
    }

    return { ok: false, error: 'open_app requires Android APK' };
  }

  async function openUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return { ok: false, error: 'url required' };
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

    if (isNativeAndroid()) {
      return nativeCall('openUrl', { url: href });
    }
    window.open(href, '_blank', 'noopener');
    return { ok: true, method: 'web' };
  }

  async function shareText(text, appId) {
    const body = String(text || '').trim();
    if (!body) return { ok: false, error: 'text required' };
    const app = appId ? resolveAppId(appId) : null;

    if (isNativeAndroid()) {
      return nativeCall('shareText', {
        text: body,
        packageName: app?.packageName,
        title: 'KASY',
      });
    }

    if (navigator.share) {
      await navigator.share({ text: body });
      return { ok: true, method: 'web_share' };
    }
    return { ok: false, error: 'share not supported' };
  }

  async function dialNumber(phone) {
    const digits = String(phone || '').trim();
    if (!digits) return { ok: false, error: 'phone required' };

    if (isNativeAndroid()) {
      return nativeCall('dialNumber', { phone: digits });
    }
    window.location.href = `tel:${digits.replace(/[^+0-9*#]/g, '')}`;
    return { ok: true, method: 'web_tel' };
  }

  async function composeSms(phone, message) {
    const digits = String(phone || '').trim();
    if (!digits) return { ok: false, error: 'phone required' };
    const body = String(message || '');

    if (isNativeAndroid()) {
      return nativeCall('composeSms', { phone: digits, message: body });
    }
    const smsUrl = `sms:${digits.replace(/[^+0-9]/g, '')}?body=${encodeURIComponent(body)}`;
    window.location.href = smsUrl;
    return { ok: true, method: 'web_sms' };
  }

  async function setAlarm(hour, minutes, message) {
    const h = parseInt(String(hour), 10);
    const m = parseInt(String(minutes), 10);
    if (Number.isNaN(h) || Number.isNaN(m)) {
      return { ok: false, error: 'hour and minutes required' };
    }

    if (isNativeAndroid()) {
      return nativeCall('setAlarm', { hour: h, minutes: m, message: message || 'KASY' });
    }
    return { ok: false, error: 'set_alarm requires Android APK' };
  }

  async function copyText(text) {
    const body = String(text ?? '');
    if (isNativeAndroid()) {
      return nativeCall('copyToClipboard', { text: body });
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(body);
      return { ok: true, method: 'web_clipboard' };
    }
    return { ok: false, error: 'clipboard not supported' };
  }

  async function openSettings(panel = 'main') {
    if (isNativeAndroid()) {
      return nativeCall('openSystemSettings', { panel });
    }
    return { ok: false, error: 'open_settings requires Android APK' };
  }

  async function searchMaps(query) {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'query required' };

    if (isNativeAndroid()) {
      return nativeCall('searchMaps', { query: q });
    }
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      '_blank',
      'noopener'
    );
    return { ok: true, method: 'web_maps_search' };
  }

  async function findContacts(query, limit = 5) {
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'query required' };

    if (isNativeAndroid()) {
      return nativeCall('findContacts', { query: q, limit });
    }
    return { ok: false, error: 'find_contacts requires Android APK' };
  }

  async function scheduleReminder(atIso, message) {
    const when = new Date(atIso);
    if (Number.isNaN(when.getTime())) {
      return { ok: false, error: 'invalid datetime' };
    }
    const text = String(message || 'KASY напомняне').trim();
    const ms = when.getTime() - Date.now();
    if (ms < 1000) {
      return { ok: false, error: 'time must be in the future' };
    }

    if (window.AIVA_NOTIFIER?.scheduleAt) {
      const ok = await window.AIVA_NOTIFIER.scheduleAt({
        at: when,
        title: 'KASY',
        body: text,
        id: Date.now() % 2147483647,
      });
      return ok
        ? { ok: true, method: 'local_notification', at: when.toISOString() }
        : { ok: false, error: 'notification not scheduled' };
    }

    return { ok: false, error: 'notifications unavailable' };
  }

  async function handleTool(name, args) {
    if (!isEnabled()) {
      return { ok: false, error: 'device actions disabled in settings' };
    }

    const a = args || {};
    switch (name) {
      case 'device_navigate':
        return navigate(a.destination, a.mode || 'drive');
      case 'device_open_app':
        return openApp(a.app);
      case 'device_open_url':
        return openUrl(a.url);
      case 'device_share_text':
        return shareText(a.text, a.app);
      case 'device_dial':
        return dialNumber(a.phone);
      case 'device_compose_sms':
        return composeSms(a.phone, a.message);
      case 'device_set_alarm':
        return setAlarm(a.hour, a.minutes, a.message);
      case 'device_copy_text':
        return copyText(a.text);
      case 'device_open_settings':
        return openSettings(a.panel || 'main');
      case 'device_search_maps':
        return searchMaps(a.query);
      case 'device_find_contacts':
        return findContacts(a.query, a.limit);
      case 'device_schedule_reminder':
        return scheduleReminder(a.at, a.message);
      default:
        return { ok: false, error: `unknown device action: ${name}` };
    }
  }

  function createTool(name, description, properties, required = []) {
    class DeviceActionTool extends FunctionCallDefinition {
      constructor() {
        super(name, description, { type: 'object', properties }, required);
      }
      functionToCall() {
        return 'pending';
      }
    }
    return new DeviceActionTool();
  }

  function getGeminiTools() {
    if (!isEnabled()) return [];

    const apps = Object.keys(APP_CATALOG).join(', ');
    return [
      createTool(
        'device_navigate',
        'Стартира навигация до адрес или място. Работи с Google Maps, Waze, Huawei Maps (geo fallback).',
        {
          destination: { type: 'string', description: 'Адрес или име на място' },
          mode: { type: 'string', enum: ['drive', 'walk'], description: 'Режим на пътуване' },
        },
        ['destination']
      ),
      createTool(
        'device_open_app',
        `Отваря инсталирано приложение. Поддържани alias: ${apps}`,
        {
          app: { type: 'string', description: 'Име на приложение (viber, whatsapp, maps, ...)' },
        },
        ['app']
      ),
      createTool(
        'device_open_url',
        'Отваря URL в браузър.',
        { url: { type: 'string', description: 'Пълен или кратък URL' } },
        ['url']
      ),
      createTool(
        'device_share_text',
        'Споделя текст — отваря share sheet или конкретно app (viber, whatsapp, telegram). Потребителят избира контакт и изпраща.',
        {
          text: { type: 'string', description: 'Текст за споделяне' },
          app: { type: 'string', description: 'Опционално: viber, whatsapp, telegram' },
        },
        ['text']
      ),
      createTool(
        'device_dial',
        'Отваря dialer с номер (потребителят натиска обаждане).',
        { phone: { type: 'string', description: 'Телефонен номер' } },
        ['phone']
      ),
      createTool(
        'device_compose_sms',
        'Отваря SMS app с попълнен номер и текст (потребителят изпраща).',
        {
          phone: { type: 'string', description: 'Телефонен номер' },
          message: { type: 'string', description: 'Текст на съобщението' },
        },
        ['phone', 'message']
      ),
      createTool(
        'device_set_alarm',
        'Отваря часовника за задаване на будилник.',
        {
          hour: { type: 'integer', description: 'Час 0-23' },
          minutes: { type: 'integer', description: 'Минути 0-59' },
          message: { type: 'string', description: 'Етикет на будилника' },
        },
        ['hour', 'minutes']
      ),
      createTool(
        'device_copy_text',
        'Копира текст в клипборда.',
        { text: { type: 'string', description: 'Текст' } },
        ['text']
      ),
      createTool(
        'device_open_settings',
        'Отваря системни настройки: wifi, bluetooth, location, battery, app.',
        {
          panel: {
            type: 'string',
            enum: ['main', 'wifi', 'bluetooth', 'location', 'battery', 'app'],
          },
        },
        []
      ),
      createTool(
        'device_search_maps',
        'Търси място в карти без да стартира навигация.',
        { query: { type: 'string', description: 'Какво да се търси' } },
        ['query']
      ),
      createTool(
        'device_find_contacts',
        'Търси контакт по име в телефонния указател (изисква разрешение).',
        {
          query: { type: 'string', description: 'Име или част от име' },
          limit: { type: 'integer', description: 'Макс. резултати (default 5)' },
        },
        ['query']
      ),
      createTool(
        'device_schedule_reminder',
        'Планира локално напомняне (ISO datetime). Не изпраща Viber/WhatsApp автоматично.',
        {
          at: { type: 'string', description: 'ISO datetime, напр. 2026-08-07T03:00:00' },
          message: { type: 'string', description: 'Текст на напомнянето' },
        },
        ['at', 'message']
      ),
    ];
  }

  function listTestActions() {
    return [
      { id: 'navigate', label: 'Навигация → София', run: () => navigate('София, България') },
      { id: 'maps_search', label: 'Търси „бензиностанция“', run: () => searchMaps('бензиностанция') },
      { id: 'open_maps', label: 'Отвори Maps', run: () => openApp('maps') },
      { id: 'open_viber', label: 'Отвори Viber', run: () => openApp('viber') },
      { id: 'share', label: 'Сподели тест', run: () => shareText('Тест от KASY Device Actions', 'whatsapp') },
      { id: 'dial', label: 'Dialer (празен)', run: () => dialNumber('*') },
      { id: 'sms', label: 'SMS чернова', run: () => composeSms('0888000000', 'Тест от KASY') },
      { id: 'alarm', label: 'Будилник 07:30', run: () => setAlarm(7, 30, 'KASY тест') },
      { id: 'copy', label: 'Копирай текст', run: () => copyText('KASY clipboard test') },
      { id: 'wifi', label: 'Wi‑Fi настройки', run: () => openSettings('wifi') },
      { id: 'contacts', label: 'Търси контакт „Иван“', run: () => findContacts('Иван', 3) },
      {
        id: 'reminder',
        label: 'Напомняне +2 мин',
        run: () => {
          const at = new Date(Date.now() + 2 * 60 * 1000).toISOString();
          return scheduleReminder(at, 'KASY device actions test');
        },
      },
    ];
  }

  window.AIVA_DEVICE_ACTIONS = {
    APP_CATALOG,
    ACTION_LABELS,
    isNativeAndroid,
    isEnabled,
    navigate,
    openApp,
    openUrl,
    shareText,
    dialNumber,
    composeSms,
    setAlarm,
    copyText,
    openSettings,
    searchMaps,
    findContacts,
    scheduleReminder,
    handleTool,
    getGeminiTools,
    listTestActions,
  };
})();
