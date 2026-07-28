/**
 * Billing / subscription UI strings — merged into AIVA_I18N at load time.
 */
(function () {
  const BILLING = {
    en: {
      billingTitle: 'Subscription',
      billingSubtitle: 'Unlock more voice sessions, cloud calendar sync, and daily AI briefs.',
      planFree: 'Free',
      planPlus: 'Plus',
      planPro: 'Pro',
      billingCurrentPlan: 'Current plan',
      billingManage: 'Manage subscription',
      billingUpgrade: 'Upgrade to Plus',
      billingPerMonth: '/ month',
      billingPerYear: '/ year',
      billingOnce: 'one-time',
      billingYearlyTrial: '7-day free trial',
      billingYearlySave: 'Save ~40%',
      billingFeatureSessions: '{count} voice sessions / day',
      billingFeatureTasks: 'Up to {count} active tasks',
      billingFeatureTasksUnlimited: 'Unlimited active tasks',
      billingFeatureCloudCal: 'Cloud calendar sync',
      billingFeatureBrief: 'Daily evening AI brief',
      billingFeatureGrounding: 'Web search in task discussions',
      billingUsageSessions: 'Voice today: {used} / {max}',
      billingUsageTasks: 'Active tasks: {used} / {max}',
      billingNotConfigured: 'Payments are being set up. All features remain available during beta.',
      billingSuccess: 'Thank you! Your subscription is active.',
      billingCancel: 'Checkout was cancelled.',
      billingTermsNote: 'By subscribing you agree to our Terms and Privacy Policy.',
      paywallTitle: 'Upgrade to KAYA Plus',
      paywallSessionLimit: 'You reached today\'s voice limit on the Free plan.',
      paywallCloudCal: 'Cloud calendar sync requires KAYA Plus.',
      paywallTaskLimit: 'Active task limit reached. Upgrade for unlimited tasks.',
      paywallBrief: 'Daily AI brief is part of KAYA Plus.',
      paywallGrounding: 'Web search in discussions requires KAYA Plus.',
      paywallCtaMonthly: 'Plus — monthly',
      paywallCtaYearly: 'Plus — yearly (7-day trial)',
      paywallLater: 'Not now',
      termsLink: 'Terms of Service',
      refundLink: 'Refund policy',
    },
    bg: {
      billingTitle: 'Абонамент',
      billingSubtitle: 'Повече гласови сесии, облачен календар и дневен AI преглед.',
      planFree: 'Безплатен',
      planPlus: 'Plus',
      planPro: 'Pro',
      billingCurrentPlan: 'Текущ план',
      billingManage: 'Управление на абонамента',
      billingUpgrade: 'Надгради до Plus',
      billingPerMonth: '/ месец',
      billingPerYear: '/ година',
      billingOnce: 'еднократно',
      billingYearlyTrial: '7 дни безплатен пробен период',
      billingYearlySave: 'Спести ~40%',
      billingFeatureSessions: '{count} гласови сесии / ден',
      billingFeatureTasks: 'До {count} активни задачи',
      billingFeatureTasksUnlimited: 'Неограничени активни задачи',
      billingFeatureCloudCal: 'Облачен календар',
      billingFeatureBrief: 'Дневен вечерен AI преглед',
      billingFeatureGrounding: 'Уеб търсене при обсъждане',
      billingUsageSessions: 'Глас днес: {used} / {max}',
      billingUsageTasks: 'Активни задачи: {used} / {max}',
      billingNotConfigured: 'Плащанията се настройват. Всички функции са достъпни по време на бета.',
      billingSuccess: 'Благодарим! Абонаментът е активен.',
      billingCancel: 'Плащането беше отменено.',
      billingTermsNote: 'С абонамента приемате Условията и Политиката за поверителност.',
      paywallTitle: 'Надградете до KAYA Plus',
      paywallSessionLimit: 'Достигнахте дневния лимит на безплатния план.',
      paywallCloudCal: 'Облачен календар изисква KAYA Plus.',
      paywallTaskLimit: 'Лимит на активни задачи. Надградете за неограничени задачи.',
      paywallBrief: 'Дневният AI преглед е част от KAYA Plus.',
      paywallGrounding: 'Уеб търсене при обсъждане изисква Plus.',
      paywallCtaMonthly: 'Plus — месечен',
      paywallCtaYearly: 'Plus — годишен (7 дни проба)',
      paywallLater: 'Не сега',
      termsLink: 'Общи условия',
      refundLink: 'Политика за възстановяване',
    },
  };

  const langs = ['zh', 'hi', 'es', 'fr', 'de', 'ru', 'ar'];
  for (const lang of langs) {
    BILLING[lang] = { ...BILLING.en };
  }

  if (window.AIVA_I18N) {
    window.AIVA_I18N.mergeStrings(BILLING);
  }
})();
