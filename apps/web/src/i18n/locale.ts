// Idioma de la interfaz (D-H0-21): lo elegido en este navegador manda; si no hay elección, el del usuario; si no, el del navegador.
import { DEFAULT_LOCALE, isLocale, type Locale } from '@onway/i18n';

export const LOCALE_STORAGE_KEY = 'onway.locale';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readStoredLocale(storage: Store | null): Locale | null {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLocale(storage: Store | null, locale: Locale): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Navegación privada o almacenamiento bloqueado: el idioma vale solo para esta sesión.
  }
}

export function browserLocale(language: string | undefined): Locale {
  const base = language?.toLowerCase().split('-')[0];
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** Idioma inicial, antes de conocer al usuario. */
export function initialLocale(storage: Store | null, language: string | undefined): Locale {
  return readStoredLocale(storage) ?? browserLocale(language);
}

/** Idioma una vez conocido el usuario: la elección guardada en el navegador gana a la del perfil. */
export function resolveLocale(storage: Store | null, userLocale: Locale | null, language: string | undefined): Locale {
  return readStoredLocale(storage) ?? userLocale ?? browserLocale(language);
}
