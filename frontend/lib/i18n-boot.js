/**
 * Early i18n bootstrap — runs in <head> before first paint.
 * Hides body until translations are applied to avoid language flash (FOUC).
 */
(function () {
  var STORAGE_KEY = 'kasy_assistant_settings_v1';
  var LEGACY_KEY = 'aiva_assistant_settings_v1';
  var RTL_LANGS = { ar: true };

  var style = document.createElement('style');
  style.id = 'i18n-boot-style';
  style.textContent = 'html:not(.i18n-ready) body{visibility:hidden}';
  (document.head || document.documentElement).appendChild(style);

  try {
    var raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    var lang = 'bg';
    if (raw) {
      var data = JSON.parse(raw);
      if (data.profile && data.profile.language) lang = data.profile.language;
    }
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS[lang] ? 'rtl' : 'ltr';
  } catch (e) { /* ignore */ }

  setTimeout(function () {
    document.documentElement.classList.add('i18n-ready');
  }, 3000);
})();
