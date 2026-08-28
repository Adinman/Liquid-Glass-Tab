/* The languages this build can actually speak.
 *
 * A locale appears here only once `<id>.js` exists beside this file. The picker
 * is built from this table, so listing a language before its catalogue is
 * written would offer a choice that does nothing — which reads as broken rather
 * than as unfinished.
 *
 * `name` is each language in its own script and its own spelling. Somebody
 * hunting for Korean is looking for 한국어, not for the English word "Korean",
 * and a list of endonyms is scannable by exactly the person who needs it. The
 * English name rides along in `en` for the benefit of anyone browsing a
 * language they do not read, and so the list can be searched either way.
 *
 * Adding a language is two lines: an entry here, and js/locales/<id>.js.
 */
export const LOCALES = [
  { id: 'en',    name: 'English',      en: 'English' },
  { id: 'es',    name: 'Español',      en: 'Spanish' },
  { id: 'hi',    name: 'हिन्दी',         en: 'Hindi' },
  { id: 'id',    name: 'Bahasa Indonesia', en: 'Indonesian' },
  { id: 'ko',    name: '한국어',         en: 'Korean' },
  { id: 'ru',    name: 'Русский',      en: 'Russian' },
  { id: 'zh-CN', name: '简体中文',       en: 'Chinese (Simplified)' },
  { id: 'bn',    name: 'বাংলা', en: 'Bengali' },
  { id: 'mr',    name: 'मराठी', en: 'Marathi' },
  { id: 'te',    name: 'తెలుగు', en: 'Telugu' },
  { id: 'ta',    name: 'தமிழ்', en: 'Tamil' },
  { id: 'gu',    name: 'ગુજરાતી', en: 'Gujarati' },
  { id: 'kn',    name: 'ಕನ್ನಡ', en: 'Kannada' },
  { id: 'ml',    name: 'മലയാളം', en: 'Malayalam' },
  { id: 'or',    name: 'ଓଡ଼ିଆ', en: 'Odia' },
  { id: 'pa',    name: 'ਪੰਜਾਬੀ', en: 'Punjabi' },
  { id: 'as',    name: 'অসমীয়া', en: 'Assamese' },
  { id: 'ur',    name: 'اردو', en: 'Urdu', rtl: true },
];

/* Right-to-left languages set `rtl: true`. None yet — Urdu is the one in the
   requested set that needs it, and it brings a whole mirrored layout with it
   rather than only reversed text, so it waits until that has been done
   properly. js/i18n.js already reads the flag and sets `dir` on the root. */
