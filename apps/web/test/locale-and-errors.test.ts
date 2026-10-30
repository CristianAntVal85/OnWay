import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { ApiError } from '@onway/contracts/client';
import { ERROR_CODES } from '@onway/contracts';
import { es, fr, resources } from '@onway/i18n';
import { createI18n } from '../src/i18n';
import { errorMessage } from '../src/i18n/error-message';
import { LOCALE_STORAGE_KEY, browserLocale, initialLocale, readStoredLocale, resolveLocale, storeLocale } from '../src/i18n/locale';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
};

describe('idioma (D-H0-21)', () => {
  it('lo elegido en el navegador gana al idioma del perfil', () => {
    expect(resolveLocale(memory({ [LOCALE_STORAGE_KEY]: 'es' }), 'fr', 'fr-FR')).toBe('es');
  });

  it('sin elección guardada manda el del perfil; sin perfil, el del navegador; si no es es/fr, español', () => {
    expect(resolveLocale(memory(), 'fr', 'es-ES')).toBe('fr');
    expect(resolveLocale(memory(), null, 'fr-CA')).toBe('fr');
    expect(resolveLocale(memory(), null, 'de-DE')).toBe('es');
    expect(browserLocale(undefined)).toBe('es');
  });

  it('ignora un valor guardado que no es un idioma y no falla si el almacenamiento no existe o se rompe', () => {
    expect(readStoredLocale(memory({ [LOCALE_STORAGE_KEY]: 'de' }))).toBeNull();
    expect(readStoredLocale(null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredLocale(broken)).toBeNull();
    expect(() => storeLocale(broken, 'fr')).not.toThrow();
    expect(initialLocale(null, 'fr')).toBe('fr');
  });

  it('guarda y recupera la elección', () => {
    const store = memory();
    storeLocale(store, 'fr');
    expect(readStoredLocale(store)).toBe('fr');
  });
});

describe('texto de los errores por code (doc 06 AC-05)', () => {
  const t = createI18n('es').t;
  const error = (code: (typeof ERROR_CODES)[number], init: { status?: number; details?: Record<string, unknown> } = {}) =>
    new ApiError({ code, message: 'texto del servidor que no se muestra', status: init.status ?? 400, requestId: 'r', details: init.details });

  it('cada código se traduce con su texto en es y en fr, no con el mensaje del servidor', () => {
    for (const locale of ['es', 'fr'] as const) {
      const tr = createI18n(locale).t;
      for (const code of ERROR_CODES) {
        const text = errorMessage(tr, error(code, { details: { retryAfterSeconds: 7 } }));
        expect(text, `${locale}:${code}`).toBe((locale === 'es' ? es : fr).errors[code].replace('{{seconds}}', '7'));
        expect(text).not.toContain('servidor');
      }
    }
  });

  it('ACCOUNT_LOCKED muestra el tiempo restante', () => {
    expect(errorMessage(t, error('ACCOUNT_LOCKED', { status: 423, details: { retryAfterSeconds: 125 } }))).toContain('125');
  });

  it('un fallo de red (la petición no salió) dice que falta conexión', () => {
    expect(errorMessage(t, error('UPSTREAM_UNAVAILABLE', { status: 0 }))).toBe(es.state.offline);
  });

  it('un error que no es del API se muestra como error inesperado', () => {
    expect(errorMessage(t, new TypeError('boom'))).toBe(es.errors.INTERNAL);
  });

  it('i18next conserva los dos idiomas del paquete', () => {
    const instance = createInstance();
    void instance.init({ resources, lng: 'fr', initAsync: false });
    expect(instance.t('nav.account')).toBe(fr.nav.account);
  });
});
