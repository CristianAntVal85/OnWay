// Tema de la interfaz (UI-rediseno T4, D-U1, D-U5, D-U6, D-U13): lógica de preferencia, proveedor, selector de Cuenta (teclado, es y fr)
// y el script de arranque `public/theme-boot.js`, que se ejecuta de verdad sobre un `window` simulado.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { es, fr } from '@onway/i18n';
import { DEFAULT_PREFERENCE, THEME_PREFERENCES, THEME_STORAGE_KEY, isThemePreference, readStoredPreference, resolveTheme, storePreference, systemTheme } from '../src/theme/theme';
import { ThemeProvider, useTheme } from '../src/theme/theme-context';
import { renderApp, sessionServer, sessionUser } from './support';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const theme = () => document.documentElement.getAttribute('data-theme');

/** `matchMedia` falso y controlable: dice si el sistema anuncia el claro y avisa a quien escuche. */
function fakeMatchMedia(initialLight: boolean) {
  let light = initialLight;
  const listeners = new Set<() => void>();
  const matchMedia = vi.fn((query: string) => ({
    media: query,
    get matches() {
      return query === '(prefers-color-scheme: light)' ? light : query === '(prefers-color-scheme: dark)' ? !light : false;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listenerCount: () => listeners.size,
    setLight: (next: boolean) => {
      light = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

beforeEach(() => document.documentElement.removeAttribute('data-theme'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe('preferencia de tema (D-U6, D-U13)', () => {
  it('la lista cerrada es oscuro, claro y como el sistema, y la clave es onway.theme', () => {
    expect([...THEME_PREFERENCES]).toEqual(['dark', 'light', 'system']);
    expect(THEME_STORAGE_KEY).toBe('onway.theme');
    expect(DEFAULT_PREFERENCE).toBe('dark');
  });

  it.each(['dark', 'light', 'system'])('lee «%s» guardado', (value) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
    expect(readStoredPreference(window.localStorage)).toBe(value);
  });

  it.each([null, '', 'Dark', 'DARK', 'auto', 'blue', ' light', 'light ', '<script>', 'dark;light', '0', '{"theme":"light"}'])('un valor guardado no válido (%j) es «sin elección»', (value) => {
    if (value !== null) window.localStorage.setItem(THEME_STORAGE_KEY, value);
    expect(readStoredPreference(window.localStorage)).toBeNull();
    expect(isThemePreference(value)).toBe(false);
  });

  it('un localStorage que lanza al leer o al escribir no rompe nada', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readStoredPreference(broken)).toBeNull();
    expect(() => storePreference(broken, 'light')).not.toThrow();
    expect(readStoredPreference(null)).toBeNull();
    expect(() => storePreference(null, 'light')).not.toThrow();
  });

  it('guarda la elección con la clave', () => {
    storePreference(window.localStorage, 'system');
    expect(window.localStorage.getItem('onway.theme')).toBe('system');
  });

  it('solo «como el sistema» sigue al sistema; oscuro y claro mandan sobre él', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
  });

  it('el sistema es claro solo si lo anuncia; sin señal, sin matchMedia o con matchMedia roto, el oscuro', () => {
    expect(systemTheme({ matchMedia: () => ({ matches: true }) as MediaQueryList })).toBe('light');
    expect(systemTheme({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe('dark');
    expect(
      systemTheme({
        matchMedia: () => {
          throw new Error('boom');
        },
      }),
    ).toBe('dark');
    expect(systemTheme({} as Window)).toBe('dark');
    expect(systemTheme(null)).toBe('dark');
  });
});

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <>
      <output data-testid="preference">{preference}</output>
      <output data-testid="resolved">{resolved}</output>
      {THEME_PREFERENCES.map((value) => (
        <button key={value} type="button" onClick={() => setPreference(value)}>
          {value}
        </button>
      ))}
    </>
  );
}
const renderProbe = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
const preference = () => screen.getByTestId('preference').textContent;
const resolved = () => screen.getByTestId('resolved').textContent;

describe('ThemeProvider y useTheme()', () => {
  it('sin elección guardada se ve el oscuro, aunque el sistema diga claro', () => {
    fakeMatchMedia(true);
    renderProbe();
    expect(preference()).toBe('dark');
    expect(resolved()).toBe('dark');
    expect(theme()).toBe('dark');
  });

  it('con un valor guardado no válido se ve el oscuro', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'rosa');
    renderProbe();
    expect(resolved()).toBe('dark');
    expect(theme()).toBe('dark');
  });

  it('con un localStorage que lanza se ve el oscuro y elegir no rompe', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const user = userEvent.setup();
    renderProbe();
    expect(theme()).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(theme()).toBe('light'); // vale mientras la página siga abierta
  });

  it('lo guardado manda al arrancar', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderProbe();
    expect(preference()).toBe('light');
    expect(theme()).toBe('light');
  });

  it('elegir cambia data-theme al momento y lo guarda', async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem('onway.theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: 'dark' }));
    expect(theme()).toBe('dark');
    expect(window.localStorage.getItem('onway.theme')).toBe('dark');
  });

  it('«como el sistema» toma el tema del sistema y lo sigue cuando cambia; las otras opciones no lo escuchan', async () => {
    const media = fakeMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    renderProbe();
    expect(preference()).toBe('system');
    expect(resolved()).toBe('light');
    expect(theme()).toBe('light');
    media.setLight(false);
    expect(theme()).toBe('dark');
    media.setLight(true);
    expect(theme()).toBe('light');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'dark' }));
    media.setLight(false);
    media.setLight(true);
    expect(theme()).toBe('dark'); // elegido el oscuro, el sistema ya no manda
    expect(window.localStorage.getItem('onway.theme')).toBe('dark');
  });

  it('«como el sistema» sin matchMedia (o sin señal) se queda en oscuro', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    renderProbe();
    expect(resolved()).toBe('dark');
  });

  it('deja de escuchar al sistema al desmontarse', () => {
    const media = fakeMatchMedia(false);
    const view = renderProbe();
    expect(media.listenerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('theme-color toma el color de la cabecera del tema (de --header-bg, sin colores en el código)', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', 'inicial');
    document.head.append(meta);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: (name: string) => (name === '--header-bg' ? ' valor-de-la-cabecera ' : '') } as CSSStyleDeclaration);
    renderProbe();
    expect(meta.getAttribute('content')).toBe('valor-de-la-cabecera');
  });

  it('fuera del proveedor falla con un mensaje claro', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('ThemeProvider ausente');
  });
});

describe('selector de tema en Cuenta (criterio 8: es, fr y teclado)', () => {
  const names = (labels: { themeDark: string; themeLight: string; themeSystem: string }) => [labels.themeDark, labels.themeLight, labels.themeSystem];

  it.each([
    ['es', es.account],
    ['fr', fr.account],
  ] as const)('ofrece Oscuro, Claro y Como el sistema como grupo con nombre (%s)', async (language, labels) => {
    window.localStorage.setItem('onway.locale', language);
    const { api } = sessionServer({ user: sessionUser() });
    renderApp({ route: '/account', fetch: api.fetch, language });
    const group = await screen.findByRole('group', { name: labels.theme });
    expect(group.tagName).toBe('FIELDSET');
    const radios = screen.getAllByRole('radio').filter((radio) => group.contains(radio));
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(names(labels));
    // Sin elección guardada, la opción marcada es Oscuro.
    expect((screen.getByRole('radio', { name: labels.themeDark }) as HTMLInputElement).checked).toBe(true);
    expect(theme()).toBe('dark');
  });

  it('los textos pedidos por D-U13 en es y fr', () => {
    expect([es.account.theme, es.account.themeDark, es.account.themeLight, es.account.themeSystem]).toEqual(['Tema', 'Oscuro', 'Claro (alto contraste)', 'Como el sistema']);
    expect([fr.account.theme, fr.account.themeDark, fr.account.themeLight, fr.account.themeSystem]).toEqual(['Thème', 'Sombre', 'Clair (contraste élevé)', 'Comme le système']);
  });

  it('con el ratón: Claro cambia data-theme al momento y guarda la clave', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ route: '/account', fetch: api.fetch });
    await user.click(await screen.findByRole('radio', { name: es.account.themeLight }));
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem('onway.theme')).toBe('light');
    expect((screen.getByRole('radio', { name: es.account.themeLight }) as HTMLInputElement).checked).toBe(true);
  });

  it.each([
    ['es', es.account],
    ['fr', fr.account],
  ] as const)('solo con teclado: Tab llega al grupo, las flechas cambian de opción y el tema (%s)', async (language, labels) => {
    window.localStorage.setItem('onway.locale', language);
    // jsdom no trae `CSS.escape`, que user-event usa para recorrer los radios con las flechas.
    vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^\w-]/g, '\\$&') });
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ route: '/account', fetch: api.fetch, language });
    await screen.findByRole('group', { name: labels.theme });
    // Tab desde el selector de idioma (su radio marcado) cae en el radio marcado del selector de tema.
    screen.getByRole('radio', { name: language === 'es' ? labels.languageEs : labels.languageFr }).focus();
    await user.tab();
    const dark = screen.getByRole('radio', { name: labels.themeDark });
    expect(document.activeElement).toBe(dark);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: labels.themeLight }));
    expect(theme()).toBe('light');
    expect(window.localStorage.getItem('onway.theme')).toBe('light');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: labels.themeSystem }));
    expect(window.localStorage.getItem('onway.theme')).toBe('system');
    expect(theme()).toBe('dark'); // el sistema simulado no anuncia el claro
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(dark);
    expect(theme()).toBe('dark');
    expect(window.localStorage.getItem('onway.theme')).toBe('dark');
  });

  it('«Como el sistema» sigue al sistema en vivo desde el selector', async () => {
    const media = fakeMatchMedia(true);
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ route: '/account', fetch: api.fetch });
    await user.click(await screen.findByRole('radio', { name: es.account.themeSystem }));
    expect(theme()).toBe('light');
    media.setLight(false);
    expect(theme()).toBe('dark');
  });

  it('la elección se conserva al cambiar de idioma y el idioma no toca el tema', async () => {
    const { api } = sessionServer({ user: sessionUser() });
    const { user } = renderApp({ route: '/account', fetch: api.fetch });
    await user.click(await screen.findByRole('radio', { name: es.account.themeLight }));
    await user.click(screen.getByRole('radio', { name: es.account.languageFr }));
    expect(await screen.findByRole('group', { name: fr.account.theme })).toBeTruthy();
    expect((screen.getByRole('radio', { name: fr.account.themeLight }) as HTMLInputElement).checked).toBe(true);
    expect(theme()).toBe('light');
  });

  it('el acceso (sin sesión) ya se ve con el tema guardado', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { api } = sessionServer();
    renderApp({ fetch: api.fetch });
    await screen.findByRole('heading', { level: 1, name: es.login.title });
    expect(theme()).toBe('light');
  });
});

describe('theme-boot.js (D-U5): antes de pintar, tolerante y con la misma clave y valores', () => {
  const script = read('public/theme-boot.js');

  /** Ejecuta el script como lo haría el navegador (clásico, con `window` y `document` globales) sobre un documento y un `window` propios. */
  function boot(win: { localStorage?: unknown; matchMedia?: unknown }, meta = true) {
    const doc = document.implementation.createHTMLDocument('x');
    if (meta) {
      const tag = doc.createElement('meta');
      tag.setAttribute('name', 'theme-color');
      tag.setAttribute('content', 'inicial');
      doc.head.append(tag);
    }
    new Function('window', 'document', script)(win, doc);
    return { theme: doc.documentElement.getAttribute('data-theme'), color: doc.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null };
  }
  const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null) });
  const media = (light: boolean) => (query: string) => ({ matches: query === '(prefers-color-scheme: light)' ? light : !light });

  it('usa la misma clave y los mismos valores que src/theme/', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    for (const value of THEME_PREFERENCES) expect(script).toContain(`'${value}'`);
    // Y se comporta igual que `resolveTheme` para cada valor y cada tema del sistema.
    for (const value of THEME_PREFERENCES) {
      for (const light of [true, false]) {
        expect(boot({ localStorage: storageWith(value), matchMedia: media(light) }).theme, `${value} / sistema ${light ? 'claro' : 'oscuro'}`).toBe(resolveTheme(value, light ? 'light' : 'dark'));
      }
    }
  });

  it('fija data-theme y theme-color con lo guardado', () => {
    expect(boot({ localStorage: storageWith('light'), matchMedia: media(false) })).toEqual({ theme: 'light', color: '#151e2a' });
    expect(boot({ localStorage: storageWith('dark'), matchMedia: media(true) })).toEqual({ theme: 'dark', color: '#151e2a' });
  });

  it('los dos colores de theme-color son los de la cabecera de tokens.css (y el de index.html, el del oscuro)', () => {
    const css = read('src/theme/tokens.css');
    const darkSurface = /\[data-theme='dark'\][\s\S]*?--surface:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const lightHeader = /\[data-theme='light'\][\s\S]*?--header-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(boot({ localStorage: storageWith('dark') }).color).toBe(darkSurface);
    expect(boot({ localStorage: storageWith('light') }).color).toBe(lightHeader);
    expect(read('index.html')).toContain(`<meta name="theme-color" content="${darkSurface}" />`);
  });

  it('«system» sigue a prefers-color-scheme', () => {
    expect(boot({ localStorage: storageWith('system'), matchMedia: media(true) }).theme).toBe('light');
    expect(boot({ localStorage: storageWith('system'), matchMedia: media(false) }).theme).toBe('dark');
  });

  it.each([null, '', 'Light', 'auto', 'blue', '<img src=x onerror=1>', 'dark;light', ' light'])('un valor no válido (%j) no toca nada', (value) => {
    expect(boot({ localStorage: storageWith(value), matchMedia: media(true) })).toEqual({ theme: null, color: 'inicial' });
  });

  it('un localStorage que lanza (al acceder a él o al leer) no rompe ni toca nada', () => {
    const throwsOnAccess = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(boot(throwsOnAccess)).toEqual({ theme: null, color: 'inicial' });
    const throwsOnRead = {
      localStorage: {
        getItem() {
          throw new Error('SecurityError');
        },
      },
    };
    expect(boot(throwsOnRead)).toEqual({ theme: null, color: 'inicial' });
    expect(boot({})).toEqual({ theme: null, color: 'inicial' }); // sin localStorage
  });

  it('«system» sin matchMedia o con matchMedia roto no toca nada (queda el oscuro del CSS)', () => {
    expect(boot({ localStorage: storageWith('system') }).theme).toBeNull();
    const broken = () => {
      throw new Error('boom');
    };
    expect(boot({ localStorage: storageWith('system'), matchMedia: broken }).theme).toBeNull();
  });

  it('funciona aunque la página no tenga la etiqueta theme-color', () => {
    expect(boot({ localStorage: storageWith('light') }, false)).toEqual({ theme: 'light', color: null });
  });

  it('index.html lo carga como script clásico y bloqueante del propio origen, en <head> y antes de la aplicación, sin scripts en línea (CSP)', () => {
    const html = read('index.html');
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
    const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
    expect(tags).toEqual(['<script src="/theme-boot.js">', '<script type="module" src="/src/main.tsx">']);
    expect(head).toContain('<script src="/theme-boot.js"></script>');
    expect(html.indexOf('/theme-boot.js')).toBeLessThan(html.indexOf('/src/main.tsx'));
    expect(html).toMatch(/<script src="\/theme-boot\.js"><\/script>/); // sin async, defer ni type=module
    expect(html).toContain('<meta name="color-scheme" content="dark light" />');
    for (const inline of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) expect(inline[1]!.trim()).toBe('');
  });

  it('el script no usa eval, innerHTML ni red', () => {
    expect(script).not.toMatch(/\beval\b|innerHTML|Function\(|fetch|XMLHttpRequest|document\.write/);
  });
});
