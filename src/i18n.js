import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import es from './locales/es.json';

// ── One-time stale cache fix ──────────────────────────────────────────────────
// If the browser language (e.g. 'en-US') doesn't match the cached language in
// localStorage (e.g. 'es'), remove the stale cache so the browser language wins.
// This only clears if the user hasn't explicitly picked a language in the UI.
(function clearStaleLangCache() {
  try {
    const cached = localStorage.getItem('i18nextLng');
    if (cached) {
      const browserLang = (navigator.language || '').slice(0, 2).toLowerCase();
      const cachedLang  = cached.slice(0, 2).toLowerCase();
      if (browserLang && browserLang !== cachedLang) {
        localStorage.removeItem('i18nextLng');
      }
    }
  } catch {
    // localStorage may be unavailable in private mode — ignore silently.
  }
})();
// ─────────────────────────────────────────────────────────────────────────────

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    supportedLngs: ['en', 'es'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'en',
    // Detection order: querystring (?lng=es) → localStorage (explicit user choice) → browser language
    // localStorage is only written when the user actively changes the language in the UI.
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lng',
      caches: ['localStorage'],
      // Do NOT cache the auto-detected navigator language — only cache explicit user picks.
      excludeCacheFor: ['cimode'],
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;
