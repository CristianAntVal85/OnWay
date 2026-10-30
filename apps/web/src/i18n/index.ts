import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, resources, type Locale } from '@onway/i18n';

/** Instancia propia de i18next (una por aplicación y una por prueba). Síncrona: los textos ya están en el paquete. */
export function createI18n(language: Locale): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  return instance;
}
