import fs from 'fs';
import { PRIVACY_STRINGS } from './i18n-privacy-locales.mjs';

const out = `/**
 * Privacy policy strings — merged into KAYA_I18N at load time.
 */
(function () {
  const PRIVACY = ${JSON.stringify(PRIVACY_STRINGS, null, 2)};
  if (window.KAYA_I18N) {
    window.KAYA_I18N.mergeStrings(PRIVACY);
  }
})();
`;

fs.writeFileSync(new URL('../frontend/lib/i18n-privacy.js', import.meta.url), out);
const langs = Object.keys(PRIVACY_STRINGS);
const keys = Object.keys(PRIVACY_STRINGS.en || {});
console.log('Wrote i18n-privacy.js:', keys.length, 'keys ×', langs.length, 'languages');
