import { createContext, useContext, useState, useCallback, useEffect } from 'react';

/**
 * Bilingual (EN/SW) support with LAZY catalogue loading.
 *
 * Both catalogues used to be static imports, so every cold load shipped ~150 KB
 * (42 KB gzipped) containing both languages — a Swahili-only user downloaded the
 * entire English catalogue, and vice versa, on every first visit. On the 2G/3G
 * connections this app targets, that is several seconds of nothing.
 *
 * Now only the active language is fetched, as its own cache-friendly chunk.
 * English is kept as the fallback for missing keys, but it is only loaded when
 * it is either the active language or actually needed as a fallback.
 *
 * Because loading is async, `t()` must work before the catalogue arrives. It
 * returns the key itself in that window, and the provider re-renders when the
 * catalogue lands — so the UI shows real text a moment later rather than
 * blocking the first paint behind a translation download.
 */

const LangContext = createContext(null);

const SUPPORTED = ['sw', 'en'];
const DEFAULT_LANG = 'sw';

// Loaded catalogues, keyed by language. Module-scoped so `getT()` (used outside
// React, e.g. by the axios interceptor) sees the same data as the provider.
const catalogues = {};
const inFlight = {};

function loadCatalogue(lang) {
  if (catalogues[lang]) return Promise.resolve(catalogues[lang]);
  if (inFlight[lang]) return inFlight[lang];

  // Vite turns these into separate chunks, fetched on demand.
  const loader = lang === 'en' ? () => import('../lang/en.json') : () => import('../lang/sw.json');

  inFlight[lang] = loader()
    .then((mod) => {
      catalogues[lang] = mod.default || mod;
      delete inFlight[lang];
      return catalogues[lang];
    })
    .catch(() => {
      // A failed catalogue load must not break the app; keys render as-is.
      delete inFlight[lang];
      return {};
    });

  return inFlight[lang];
}

function readStoredLang() {
  try {
    const saved = localStorage.getItem('app_lang');
    return SUPPORTED.includes(saved) ? saved : DEFAULT_LANG;
  } catch {
    // Private mode / blocked site data.
    return DEFAULT_LANG;
  }
}

function translate(lang, key, params = {}) {
  const active = catalogues[lang];
  const fallback = catalogues.en;
  let value = active?.[key] ?? fallback?.[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    value = String(value).replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return value;
}

let _currentLang = readStoredLang();

// Warm the active catalogue immediately at module load, so the fetch overlaps
// with React mounting rather than starting after it.
loadCatalogue(_currentLang);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(_currentLang);
  // Bumped when a catalogue finishes loading, to re-render with real strings.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadCatalogue(lang).then(() => {
      if (!cancelled) setRevision((r) => r + 1);
    });
    // Ensure the English fallback exists for keys the active language misses.
    if (lang !== 'en') {
      loadCatalogue('en').then(() => {
        if (!cancelled) setRevision((r) => r + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLanguage = useCallback((newLang) => {
    if (!SUPPORTED.includes(newLang)) return;
    _currentLang = newLang;
    setLang(newLang);
    try {
      localStorage.setItem('app_lang', newLang);
    } catch {
      /* preference simply will not persist */
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(_currentLang === 'sw' ? 'en' : 'sw');
  }, [setLanguage]);

  const t = useCallback(
    (key, params = {}) => translate(lang, key, params),
    // `revision` is a dependency on purpose: it is what makes `t` produce new
    // output once a catalogue has loaded.
    [lang, revision]
  );

  return (
    <LangContext.Provider value={{ lang, setLanguage, toggleLanguage, t, ready: !!catalogues[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

/** Translator for use outside React (axios interceptors, helpers). */
export function getT() {
  return (key, params = {}) => translate(_currentLang, key, params);
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within a LangProvider');
  return ctx;
}

export default LangContext;
