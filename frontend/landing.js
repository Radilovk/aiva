/**
 * KASY landing page — nav, FAQ, scroll reveal, language picker.
 */
(function () {
  const STORAGE_KEY = 'aiva_assistant_settings_v1';
  const RTL_LANGS = { ar: true };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { profile: { language: 'bg' } };
  }

  function saveLanguage(lang) {
    const settings = loadSettings();
    if (!settings.profile) settings.profile = {};
    settings.profile.language = lang;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function getLang() {
    const settings = loadSettings();
    return settings.profile?.language || 'bg';
  }

  function applyLang(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS[lang] ? 'rtl' : 'ltr';
    if (window.AIVA_I18N) {
      window.AIVA_I18N.applyToDocument(document, lang);
      document.title = window.AIVA_I18N.t('landingPageTitle', lang);
    }
  }

  function initNav() {
    const nav = document.getElementById('landingNav');
    const toggle = document.getElementById('navToggle');
    const mobileMenu = document.getElementById('mobileMenu');

    function onScroll() {
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (toggle && mobileMenu) {
      toggle.addEventListener('click', () => {
        const open = mobileMenu.classList.toggle('open');
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      mobileMenu.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', () => {
          mobileMenu.classList.remove('open');
          toggle.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    }
  }

  function initFaq() {
    document.querySelectorAll('.faq-item').forEach((item) => {
      const btn = item.querySelector('.faq-question');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach((el) => el.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
      });
    });
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    els.forEach((el) => observer.observe(el));
  }

  function initLangSelect() {
    const select = document.getElementById('langSelect');
    if (!select || !window.AIVA_I18N) return;

    window.AIVA_I18N.populateLanguageSelect(select, getLang());

    select.addEventListener('change', () => {
      const lang = select.value;
      saveLanguage(lang);
      applyLang(lang);
    });
  }

  function init() {
    initNav();
    initFaq();
    initReveal();
    initLangSelect();
    applyLang(getLang());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
