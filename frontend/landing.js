/**
 * KASY landing — mobile-first interactions (2026 patterns).
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
    return loadSettings().profile?.language || 'bg';
  }

  function applyLang(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGS[lang] ? 'rtl' : 'ltr';
    if (window.AIVA_I18N) {
      window.AIVA_I18N.applyToDocument(document, lang);
      document.title = window.AIVA_I18N.t('landingPageTitle', lang);
    }
  }

  function initTopBar() {
    const bar = document.getElementById('topBar');
    if (!bar) return;
    window.addEventListener('scroll', () => {
      bar.classList.toggle('scrolled', window.scrollY > 8);
    }, { passive: true });
  }

  function initFaq() {
    document.querySelectorAll('.faq-item').forEach((item) => {
      const btn = item.querySelector('.faq-q');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const open = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach((el) => el.classList.remove('open'));
        if (!open) item.classList.add('open');
      });
    });
  }

  function initSnapDots() {
    const scroll = document.getElementById('featuresSnap');
    const dotsWrap = document.getElementById('featuresDots');
    if (!scroll || !dotsWrap) return;

    const cards = scroll.querySelectorAll('.snap-card');
    if (!cards.length) return;

    cards.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'snap-dot' + (i === 0 ? ' active' : '');
      dotsWrap.appendChild(dot);
    });

    const dots = dotsWrap.querySelectorAll('.snap-dot');

    scroll.addEventListener('scroll', () => {
      const idx = Math.round(scroll.scrollLeft / (cards[0].offsetWidth + 12));
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });
  }

  function initDockHighlight() {
    const links = document.querySelectorAll('.dock-link[data-section]');
    const sections = ['features', 'pricing', 'faq'].map((id) => document.getElementById(id)).filter(Boolean);
    if (!links.length || !sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          links.forEach((link) => {
            link.classList.toggle('active', link.getAttribute('data-section') === id);
          });
        });
      },
      { rootMargin: '-40% 0px -45% 0px', threshold: 0 }
    );

    sections.forEach((s) => observer.observe(s));
  }

  function initLangPicker() {
    const picker = document.getElementById('langPicker');
    const btn = document.getElementById('langPickerBtn');
    const menu = document.getElementById('langPickerMenu');
    const codeEl = document.getElementById('langPickerCode');
    const labelEl = document.getElementById('langPickerLabel');
    if (!picker || !btn || !menu || !window.AIVA_I18N) return;

    const langs = window.AIVA_I18N.SUPPORTED_LANGUAGES || [];
    let backdrop = picker.querySelector('.lang-picker-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'lang-picker-backdrop';
      backdrop.hidden = true;
      picker.insertBefore(backdrop, picker.firstChild);
    }

    function updateButton(langCode) {
      const lang = langs.find((l) => l.code === langCode) || langs[0];
      if (!lang) return;
      codeEl.textContent = lang.code.toUpperCase();
      labelEl.textContent = lang.nativeLabel;
      btn.setAttribute('aria-label', lang.nativeLabel);
      menu.querySelectorAll('.lang-picker-option').forEach((opt) => {
        const selected = opt.dataset.lang === langCode;
        opt.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
    }

    function closeMenu() {
      menu.hidden = true;
      backdrop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      menu.hidden = false;
      backdrop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const selected = menu.querySelector('[aria-selected="true"]');
      selected?.focus?.();
    }

    menu.innerHTML = '';
    for (const lang of langs) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'lang-picker-option';
      opt.role = 'option';
      opt.dataset.lang = lang.code;
      opt.innerHTML = `<span class="lang-picker-option-code">${lang.code.toUpperCase()}</span><span>${lang.nativeLabel}</span>`;
      opt.addEventListener('click', () => {
        saveLanguage(lang.code);
        applyLang(lang.code);
        updateButton(lang.code);
        closeMenu();
        btn.focus();
      });
      menu.appendChild(opt);
    }

    const current = getLang();
    updateButton(current);

    btn.addEventListener('click', () => {
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    backdrop.addEventListener('click', closeMenu);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        btn.focus();
      }
    });
  }

  function initApkDownload() {
    const url = window.AIVA_CONFIG?.APK_DOWNLOAD_URL;
    if (!url) return;

    if (/Android/i.test(navigator.userAgent)) {
      document.documentElement.classList.add('show-apk-download');
    }

    document.querySelectorAll('.apk-download-btn').forEach((el) => {
      el.href = url;
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('target', '_blank');
    });
  }

  function init() {
    initTopBar();
    initFaq();
    initSnapDots();
    initDockHighlight();
    initLangPicker();
    initApkDownload();
    applyLang(getLang());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
