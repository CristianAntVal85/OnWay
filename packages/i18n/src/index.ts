// Textos de interfaz es / fr. Sin React: los consume react-i18next en la web y, más adelante, la app móvil.
import type { ErrorCode } from '@onway/contracts';
import { es } from './es.js';
import { fr } from './fr.js';

export type { Messages } from './types.js';
export { es, fr };

export const LOCALES = ['es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

/** Recursos en el formato de i18next: `{ es: { translation: … }, fr: { translation: … } }`. */
export const resources = {
  es: { translation: es },
  fr: { translation: fr },
} as const;

/** Clave de i18next del texto de un código de error. */
export const errorKey = (code: ErrorCode): `errors.${ErrorCode}` => `errors.${code}`;

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
