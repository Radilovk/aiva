/**
 * First-run onboarding: language → name → app intro.
 */
(function () {
  const STEP_LANG = 0;
  const STEP_NAME = 1;
  const STEP_INTRO = 2;

  let currentStep = STEP_LANG;
  let selectedLang = 'bg';

  function getSettingsApi() {
    return window.AIVA_SETTINGS;
  }

  function isComplete() {
    const settings = getSettingsApi()?.loadAssistantSettings?.();
    return !!settings?.profile?.onboardingComplete;
  }

  function show() {
    const overlay = document.getElementById('appOnboard');
    if (!overlay) return;
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    currentStep = STEP_LANG;
    const settings = getSettingsApi()?.loadAssistantSettings?.();
    selectedLang = settings?.profile?.language || 'bg';
    renderStep();
  }

  function hide() {
    const overlay = document.getElementById('appOnboard');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function saveProfile(patch) {
    const api = getSettingsApi();
    if (!api) return null;
    const current = api.loadAssistantSettings();
    const next = api.saveAssistantSettings({
      ...current,
      profile: { ...current.profile, ...patch },
    });
    window.AIVA_I18N?.initFromSettings?.(next);
    window.AIVA_I18N?.applyToDocument?.(document, next.profile.language);
    window.dispatchEvent(new CustomEvent('aiva:profile-updated', { detail: next }));
    return next;
  }

  function renderStep() {
    const steps = document.querySelectorAll('.onboard-step');
    steps.forEach((el, i) => {
      el.hidden = i !== currentStep;
    });

    const dots = document.querySelectorAll('.onboard-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === currentStep);
      dot.classList.toggle('done', i < currentStep);
    });

    const lang = selectedLang;
    window.AIVA_I18N?.setLanguage?.(lang);
    window.AIVA_I18N?.applyToDocument?.(document.getElementById('appOnboard'), lang);

    if (currentStep === STEP_LANG) {
      const grid = document.getElementById('onboardLangGrid');
      if (grid && !grid._populated) {
        grid._populated = true;
        const langs = window.AIVA_I18N?.SUPPORTED_LANGUAGES || [];
        for (const l of langs) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'onboard-lang-btn';
          btn.dataset.lang = l.code;
          btn.textContent = l.nativeLabel;
          btn.addEventListener('click', () => {
            selectedLang = l.code;
            grid.querySelectorAll('.onboard-lang-btn').forEach((b) => {
              b.classList.toggle('selected', b.dataset.lang === selectedLang);
            });
            window.AIVA_I18N?.setLanguage?.(selectedLang);
            window.AIVA_I18N?.applyToDocument?.(document.getElementById('appOnboard'), selectedLang);
          });
          grid.appendChild(btn);
        }
      }
      grid?.querySelectorAll('.onboard-lang-btn').forEach((b) => {
        b.classList.toggle('selected', b.dataset.lang === selectedLang);
      });
    }

    if (currentStep === STEP_NAME) {
      const nameInput = document.getElementById('onboardUserName');
      const settings = getSettingsApi()?.loadAssistantSettings?.();
      if (nameInput && !nameInput.value && settings?.profile?.userName) {
        nameInput.value = settings.profile.userName;
      }
    }

    const nextBtn = document.getElementById('onboardNext');
    if (nextBtn) {
      nextBtn.textContent = currentStep === STEP_INTRO
        ? window.AIVA_I18N?.t?.('getStarted', selectedLang) || 'Get started'
        : window.AIVA_I18N?.t?.('continue', selectedLang) || 'Continue';
    }
  }

  function goNext() {
    if (currentStep === STEP_LANG) {
      saveProfile({ language: selectedLang });
      currentStep = STEP_NAME;
      renderStep();
      return;
    }

    if (currentStep === STEP_NAME) {
      const nameInput = document.getElementById('onboardUserName');
      const userName = (nameInput?.value || '').trim();
      saveProfile({ userName, language: selectedLang });
      currentStep = STEP_INTRO;
      renderStep();
      return;
    }

    if (currentStep === STEP_INTRO) {
      saveProfile({ onboardingComplete: true, language: selectedLang });
      hide();
    }
  }

  function bindUI() {
    const overlay = document.getElementById('appOnboard');
    if (!overlay || overlay._bound) return;
    overlay._bound = true;

    document.getElementById('onboardNext')?.addEventListener('click', goNext);
    document.getElementById('onboardSkip')?.addEventListener('click', () => {
      saveProfile({ onboardingComplete: true, language: selectedLang });
      hide();
    });
  }

  function checkOnLoad() {
    bindUI();
    if (!isComplete()) {
      setTimeout(show, 400);
    }
  }

  window.AIVA_APP_ONBOARD = {
    isComplete,
    show,
    hide,
    checkOnLoad,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkOnLoad);
  } else {
    checkOnLoad();
  }
})();
