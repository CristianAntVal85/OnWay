import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isLocale, type Locale } from '@onway/i18n';
import { resolveLocale, storeLocale } from './locale';

export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Idioma activo y cambio en este navegador. En Cuenta, el selector lo guarda además en la cuenta con `updateMe` (H5-perfil, D-P6; antes D-H0-21). */
export function useLocale() {
  const { i18n } = useTranslation();
  const locale: Locale = isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'es';
  const setLocale = (next: Locale) => {
    storeLocale(browserStorage(), next);
    void i18n.changeLanguage(next);
  };
  return { locale, setLocale };
}

/** Aplica el idioma del perfil al conocer al usuario, salvo que ya haya elegido uno en este navegador; y refleja el idioma en `<html lang>`. */
export function useLocaleSync(userLocale: Locale | null) {
  const { i18n } = useTranslation();
  useEffect(() => {
    const wanted = resolveLocale(browserStorage(), userLocale, navigator.language);
    if (wanted !== i18n.resolvedLanguage) void i18n.changeLanguage(wanted);
  }, [i18n, userLocale]);
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? 'es';
  }, [i18n.resolvedLanguage]);
}
