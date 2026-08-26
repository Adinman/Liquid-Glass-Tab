/* Translation.
 *
 * The English text is the key. `t('Backdrop blur')` looks that string up in the
 * active catalogue and hands back the original if it is not there.
 *
 * That is a deliberate choice over symbolic keys like `settings.glass.blur`:
 *
 *  - There is no English catalogue to write or keep in step. The source is the
 *    catalogue, so English can never drift out of date with itself.
 *  - The code still reads as English. `row(t('Backdrop blur'), …)` says what it
 *    renders; `row(t('settings.glass.blur'), …)` needs a second file open to
 *    know what the screen says.
 *  - A missing translation degrades to English rather than to a blank label or
 *    a raw key on screen, which is the failure mode that makes half-translated
 *    software look broken.
 *  - Editing the English breaks the link to that string's translations, and
 *    they fall back to English until retranslated. That is the safe direction
 *    to fail in — the alternative is a stale translation of text that no longer
 *    says the same thing.
 *
 * Catalogues are lazy: only the active language is fetched, so a tab running in
 * English loads none of them. `t` is synchronous, so the catalogue has to be in
 * before anything renders — see initI18n, which app.js awaits before its first
 * paint of the page chrome.
 */
import { S } from './state.js';
import { LOCALES } from './locales/index.js';

let cat = {};                 // the active catalogue; empty means English
let active = 'en';
const listeners = new Set();

/** The language actually in use, after resolving 'auto'. */
export const locale = () => active;

export const localeMeta = () => LOCALES.find(l => l.id === active) || LOCALES[0];

/** Right-to-left languages need the whole document mirrored, not just text. */
export const isRTL = () => !!localeMeta().rtl;

/**
 * Translate. `vars` fills `{name}` placeholders — the same braces in every
 * language, so a translator moves them around the sentence rather than being
 * tied to English word order.
 */
export function t(en, vars) {
  let s = cat[en];
  if (typeof s !== 'string' || s === '') s = en;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Plural forms, kept deliberately small.
 *
 *  Only two cases, because that is all this app needs — "1 bookmark" against
 *  "5 bookmarks". Languages with richer plural rules (Russian has three, Arabic
 *  six) get the `other` form for everything except exactly one, which is wrong
 *  for 2-4 in Russian and right everywhere else this is used. A full CLDR
 *  plural engine is a lot of machinery for the handful of counted strings here;
 *  where it matters, the catalogue can supply a sentence that avoids the
 *  problem instead.
 */
export function plural(n, one, other, vars = {}) {
  return t(n === 1 ? one : other, { ...vars, n });
}

/** Pick the best available catalogue for a browser language tag.
 *
 *  `pt-BR` should find `pt-BR` if we have it and `pt` otherwise; `en-AU` should
 *  find English and stop, not fall through to the first locale in the table. */
export function resolve(tag) {
  const want = String(tag || '').toLowerCase().replace('_', '-');
  if (!want) return 'en';
  if (LOCALES.some(l => l.id.toLowerCase() === want)) {
    return LOCALES.find(l => l.id.toLowerCase() === want).id;
  }
  const base = want.split('-')[0];
  const hit = LOCALES.find(l => l.id.toLowerCase().split('-')[0] === base);
  return hit ? hit.id : 'en';
}

/** What the setting resolves to right now. 'auto' follows the browser. */
export function wanted() {
  const pref = S.language || 'auto';
  if (pref !== 'auto') {
    return LOCALES.some(l => l.id === pref) ? pref : 'en';
  }
  // navigator.languages is in preference order, so the first one we actually
  // have a catalogue for wins — not merely the first one listed.
  for (const tag of (navigator.languages || [navigator.language || 'en'])) {
    const hit = resolve(tag);
    if (hit !== 'en') return hit;
  }
  return resolve(navigator.language);
}

/** Load a catalogue and make it live. Safe to call repeatedly. */
export async function setLocale(id) {
  const next = LOCALES.some(l => l.id === id) ? id : 'en';
  if (next === active && (next === 'en' || Object.keys(cat).length)) return;

  if (next === 'en') {
    cat = {};
  } else {
    try {
      const mod = await import(`./locales/${next}.js`);
      cat = mod.messages || {};
    } catch (e) {
      // A missing or broken catalogue must not blank the interface. English is
      // always reachable because it needs no file at all.
      console.error('[cgt] locale', next, e);
      cat = {};
      active = 'en';
      applyDocumentLanguage();
      return;
    }
  }
  active = next;
  applyDocumentLanguage();
}

/** `lang` matters for hyphenation, spellcheck and the font fallback chain;
 *  `dir` mirrors the whole layout for Urdu. Both belong on the root. */
function applyDocumentLanguage() {
  const root = document.documentElement;
  root.lang = active;
  root.dir = isRTL() ? 'rtl' : 'ltr';
}

/* Static markup.
 *
 * Most of the interface is built in JS and translated as it is built, but the
 * shell in newtab.html is not — the settings header, the search box, the
 * palette hint. Those carry a `data-i18n*` attribute whose VALUE is the English
 * key, rather than being read out of the element itself: after one language
 * switch the element holds Korean, and translating Korean-as-a-key finds
 * nothing. Keeping the key in the attribute means every switch translates from
 * English, however many times it happens.
 */
const DOM_ATTRS = [
  ['data-i18n', el => { el.textContent = t(el.getAttribute('data-i18n')); }],
  ['data-i18n-title', el => { el.title = t(el.getAttribute('data-i18n-title')); }],
  ['data-i18n-placeholder',
    el => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); }],
  ['data-i18n-label',
    el => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-label'))); }],
];

export function translateDOM(root = document) {
  for (const [attr, apply] of DOM_ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      try { apply(el); } catch { /* one bad node must not stop the rest */ }
    }
  }
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Switch language and tell the page to redraw itself. */
export async function changeLocale(id) {
  await setLocale(id);
  translateDOM();
  for (const fn of listeners) {
    try { fn(active); } catch (e) { console.error('[cgt] locale listener', e); }
  }
}

/** Called once, before the first render, so `t` never returns English on a
 *  page that is about to be Korean. */
export async function initI18n() {
  await setLocale(wanted());
  translateDOM();
}
