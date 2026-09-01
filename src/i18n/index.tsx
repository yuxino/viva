import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "./en";
import zhHans from "./zh-Hans";

export type VivaLanguage = "en" | "zh-Hans";
export type LanguagePreference = "system" | VivaLanguage;
export type TranslationKey = keyof typeof en;
export type InterpolationValue = number | string;

export interface LanguageStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface I18nContextValue {
  language: VivaLanguage;
  locale: string;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: TranslationKey) => string;
  fmt: (key: TranslationKey, ...values: InterpolationValue[]) => string;
  formatDateTime: (
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

export interface I18nProviderProps {
  children: ReactNode;
  initialPreference?: LanguagePreference;
  storage?: LanguageStorage | null;
  systemLanguages?: readonly string[];
}

export const LANGUAGE_STORAGE_KEY = "viva.language";

const dictionaries: Record<VivaLanguage, Record<TranslationKey, string>> = {
  en,
  "zh-Hans": zhHans,
};

const locales: Record<VivaLanguage, string> = {
  en: "en-US",
  "zh-Hans": "zh-CN",
};

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return ["en"];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : ["en"];
}

function browserStorage(): LanguageStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function detectLanguage(
  languages: readonly string[] = browserLanguages(),
): VivaLanguage {
  for (const candidate of languages) {
    if (/^zh(?:-|$)/i.test(candidate.trim())) return "zh-Hans";
  }
  return "en";
}

export function normalizeLanguagePreference(
  value: unknown,
): LanguagePreference {
  return value === "en" || value === "zh-Hans" || value === "system"
    ? value
    : "system";
}

export function loadLanguagePreference(
  storage: LanguageStorage | null = browserStorage(),
): LanguagePreference {
  if (!storage) return "system";
  try {
    return normalizeLanguagePreference(storage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function saveLanguagePreference(
  preference: LanguagePreference,
  storage: LanguageStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Language selection still applies for this session.
  }
}

export function getIntlLocale(language: VivaLanguage): string {
  return locales[language];
}

export function translate(
  language: VivaLanguage,
  key: TranslationKey,
): string {
  return dictionaries[language][key] ?? en[key];
}

export function interpolate(
  language: VivaLanguage,
  template: string,
  values: readonly InterpolationValue[],
): string {
  let valueIndex = 0;
  const numberFormatter = new Intl.NumberFormat(getIntlLocale(language));
  return template.replace(/%%|%@|%d/g, (token) => {
    if (token === "%%") return "%";
    const value = values[valueIndex];
    valueIndex += 1;
    if (value === undefined) return token;
    if (token === "%d" && typeof value === "number") {
      return numberFormatter.format(value);
    }
    return String(value);
  });
}

function contextValue(
  language: VivaLanguage,
  preference: LanguagePreference,
  setPreference: (next: LanguagePreference) => void,
): I18nContextValue {
  const locale = getIntlLocale(language);
  const t = (key: TranslationKey) => translate(language, key);
  return {
    language,
    locale,
    preference,
    setPreference,
    t,
    fmt: (key, ...values) => interpolate(language, t(key), values),
    formatDateTime: (value, options) =>
      new Intl.DateTimeFormat(locale, options).format(value),
    formatNumber: (value, options) =>
      new Intl.NumberFormat(locale, options).format(value),
  };
}

const I18nContext = createContext<I18nContextValue>(
  contextValue("en", "system", () => undefined),
);

export function I18nProvider({
  children,
  initialPreference,
  storage = browserStorage(),
  systemLanguages,
}: I18nProviderProps) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(() =>
    initialPreference === undefined
      ? loadLanguagePreference(storage)
      : normalizeLanguagePreference(initialPreference),
  );
  const [detectedLanguage, setDetectedLanguage] = useState<VivaLanguage>(() =>
    detectLanguage(systemLanguages ?? browserLanguages()),
  );

  useEffect(() => {
    if (systemLanguages) {
      setDetectedLanguage(detectLanguage(systemLanguages));
      return;
    }
    const handleLanguageChange = () => {
      setDetectedLanguage(detectLanguage());
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, [systemLanguages]);

  useEffect(() => {
    if (!storage || typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      setPreferenceState(normalizeLanguagePreference(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [storage]);

  const setPreference = useCallback(
    (next: LanguagePreference) => {
      const normalized = normalizeLanguagePreference(next);
      setPreferenceState(normalized);
      saveLanguagePreference(normalized, storage);
    },
    [storage],
  );
  const language = preference === "system" ? detectedLanguage : preference;

  useEffect(() => {
    const previousLang = document.documentElement.lang;
    const previousLanguageData = document.documentElement.dataset.language;
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    return () => {
      document.documentElement.lang = previousLang;
      if (previousLanguageData === undefined) {
        delete document.documentElement.dataset.language;
      } else {
        document.documentElement.dataset.language = previousLanguageData;
      }
    };
  }, [language]);

  const value = useMemo(
    () => contextValue(language, preference, setPreference),
    [language, preference, setPreference],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
