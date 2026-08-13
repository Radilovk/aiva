/**
 * Account UI strings — merged into AIVA_I18N at load time.
 */
(function () {
  const ACCOUNT = {
    en: {
      accountTitle: 'Account',
      accountSubtitle: 'Save tasks and subscription across web, PWA and APK with your email.',
      accountEmailLabel: 'Email',
      accountSendCode: 'Send code',
      accountCodeLabel: '6-digit code',
      accountVerify: 'Sign in',
      accountLoggedInAs: 'Signed in as {email}',
      accountLogout: 'Sign out',
      accountRestoreBilling: 'Restore subscription',
      accountRestoreSuccess: 'Subscription restored.',
      accountRestoreNone: 'No active subscription found for this email.',
      accountCodeSent: 'Check your email for the code.',
      accountDevCode: 'Dev code: {code}',
      accountLoginSuccess: 'Account saved. Reloading…',
      accountLoginSuccessWithSub: 'Signed in. Your {tier} subscription is active.',
      accountLogoutDone: 'Signed out.',
      accountBanner: 'Save your account — keep tasks and subscription on all devices',
      accountBannerAction: 'Save account',
      accountBillingHint: 'Payment successful. Sign in with the same email to keep Plus on this device.',
      accountErrInvalidEmail: 'Invalid email address',
      accountErrRateLimit: 'Too many attempts. Try again later.',
      accountErrCodeInvalid: 'Wrong code',
      accountErrCodeExpired: 'Code expired. Request a new one.',
      accountErrGeneric: 'Something went wrong. Try again.',
    },
    bg: {
      accountTitle: 'Акаунт',
      accountSubtitle: 'Запазете задачите и абонамента на всички устройства с email.',
      accountEmailLabel: 'Email',
      accountSendCode: 'Изпрати код',
      accountCodeLabel: '6-цифрен код',
      accountVerify: 'Вход',
      accountLoggedInAs: 'Влезли сте като {email}',
      accountLogout: 'Изход',
      accountRestoreBilling: 'Възстанови абонамент',
      accountRestoreSuccess: 'Абонаментът е възстановен.',
      accountRestoreNone: 'Няма активен абонамент за този email.',
      accountCodeSent: 'Проверете email-а си за кода.',
      accountDevCode: 'Dev код: {code}',
      accountLoginSuccess: 'Акаунтът е запазен. Презареждане…',
      accountLoginSuccessWithSub: 'Влязохте успешно. Абонаментът {tier} е активен.',
      accountLogoutDone: 'Излязохте от акаунта.',
      accountBanner: 'Запазете акаунта — задачите и абонаментът на всички устройства',
      accountBannerAction: 'Запази акаунт',
      accountBillingHint: 'Плащането е успешно. Влезте със същия email, за да запазите Plus на това устройство.',
      accountErrInvalidEmail: 'Невалиден email адрес',
      accountErrRateLimit: 'Твърде много опити. Опитайте по-късно.',
      accountErrCodeInvalid: 'Грешен код',
      accountErrCodeExpired: 'Кодът е изтекъл. Поискайте нов.',
      accountErrGeneric: 'Нещо се обърка. Опитайте отново.',
    },
  };

  const langs = ['zh', 'hi', 'es', 'fr', 'de', 'ru', 'ar'];
  for (const lang of langs) {
    ACCOUNT[lang] = { ...ACCOUNT.en };
  }

  window.AIVA_I18N_ACCOUNT = ACCOUNT;
  if (window.AIVA_I18N?.mergeStrings) {
    window.AIVA_I18N.mergeStrings(ACCOUNT);
  }
})();
