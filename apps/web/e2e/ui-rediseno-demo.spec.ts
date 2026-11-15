// Demostración del hito UI-rediseno (plan §7, puntos 1 a 5) contra la pila real de `compose.yml` + `infra/compose.e2e.yml`.
//   1. Sin preferencia guardada, el acceso sale oscuro (D-U13) y el fondo del `body` es el valor de `--bg`, leído de la variable.
//   2. Coordinador, administrador y rescatista, en 375, 768, 1280, 1920 y 2560 px: sin desborde en las vistas del §1, contenido centrado
//      y ancho por tipo de página (lectura 64rem, listas 80rem, mapas sin tope; `medidas.md` §6).
//   3. Crear misión: el alto del mapa con los umbrales de `medidas.md` §6, en los dos temas.
//   4. Cuenta -> «Claro» al momento, tras recargar (ya en `DOMContentLoaded`) y tras cerrar sesión; vuelta a «Oscuro»; «Como el sistema»
//      con `emulateMedia`; y la parte en francés a 375 px solo con el teclado.
//   5. Biblioteca con la capa de carreteras: se pide `sprites/v4/dark.json` y, al cambiar, `light.json`, con el mismo `<canvas>` y las
//      rutas pintadas.
// Fija él mismo los anchos (corre en el proyecto `desktop` y no depende del tamaño de ventana de la configuración). Solo LEE la semilla: no
// crea misiones, rutas ni cuentas, así que no deja nada que retirar. Cada prueba abre su propio contexto (el de Playwright: sin
// `localStorage`, ni sesión); la preferencia de tema solo se guarda en el navegador de esa prueba.
import type { Locator, Page } from '@playwright/test';
import { THEME_STORAGE_KEY } from '../src/theme/theme';
import { ACCOUNTS, chooseMapLayer, fr, mapLayerButton } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, tabTo, test } from './support/demo';

const WIDTHS = [375, 768, 1280, 1920, 2560] as const;
/** El alto no importa para la anchura; uno de escritorio razonable. */
const HEIGHT = 900;

test.describe.configure({ timeout: 180_000 });

// ---- Lectura del tema desde el navegador ---------------------------------------------------------------------------------------------

interface BackgroundReading {
  /** `data-theme` de <html>. */
  theme: string | null;
  /** Color calculado del fondo del `body`. */
  body: string;
  /** Color calculado de `var(--bg)`, resuelto por el navegador sobre un elemento de prueba (no un literal del E2E). */
  token: string;
  /** El valor crudo de `--bg`. */
  raw: string;
}

async function readBackground(page: Page): Promise<BackgroundReading> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--bg)';
    document.body.append(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      body: getComputedStyle(document.body).backgroundColor,
      token,
      raw: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    };
  });
}

/** El fondo del `body` es el de `--bg` y el tema es el esperado. Devuelve la lectura para compararla con otro tema. */
async function expectTheme(page: Page, theme: 'dark' | 'light', where: string): Promise<BackgroundReading> {
  await expect(page.locator('html'), where).toHaveAttribute('data-theme', theme);
  const reading = await readBackground(page);
  expect(reading.raw, `${where}: --bg tiene valor`).not.toBe('');
  expect(reading.body, `${where}: el fondo del body es el de --bg`).toBe(reading.token);
  return reading;
}

interface ThemeSpy {
  seen: string[];
  atDomContentLoaded: string | null;
}
type SpyWindow = Window & { __themeSpy?: ThemeSpy };

/** Antes de cualquier script de la página: anota cada valor de `data-theme` que toma <html> y el que tiene al llegar `DOMContentLoaded`. */
async function installThemeSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spy: ThemeSpy = { seen: [], atDomContentLoaded: null };
    (window as SpyWindow).__themeSpy = spy;
    const read = () => document.documentElement.getAttribute('data-theme');
    // A estas alturas <html> aún no existe: se observa el documento entero (y su subárbol) en vez de `documentElement`.
    new MutationObserver(() => spy.seen.push(String(read()))).observe(document, { attributes: true, attributeFilter: ['data-theme'], subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
      spy.atDomContentLoaded = read();
    });
  });
}

/** Lo que el espía vio en la página recién cargada: el tema ya estaba puesto en `DOMContentLoaded` y nunca pasó por el otro. */
async function expectNoFlash(page: Page, theme: 'dark' | 'light', where: string): Promise<void> {
  const spy = await page.evaluate(() => (window as SpyWindow).__themeSpy!);
  expect(spy.atDomContentLoaded, `${where}: data-theme en DOMContentLoaded`).toBe(theme);
  expect(spy.seen.length, `${where}: el arranque fijó el tema`).toBeGreaterThan(0);
  expect(
    spy.seen.every((value) => value === theme),
    `${where}: valores vistos ${spy.seen.join(',')}`,
  ).toBe(true);
}

const themeRadio = (page: Page, label: string): Locator => page.getByRole('radio', { name: label, exact: true });

// ---- 1. Sin preferencia: oscuro ------------------------------------------------------------------------------------------------------

test('without a saved choice the login is dark, even if the system says light, and the page background is --bg', async ({ page }) => {
  // El sistema dice «claro»: sin elección guardada manda el oscuro (D-U13).
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: es.login.submit })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY), 'nada guardado').toBeNull();

  const dark = await expectTheme(page, 'dark', 'login a 1280');
  // El mismo fondo en todos los anchos (la maquetación cambia; el tema no).
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    const reading = await readBackground(page);
    expect.soft(reading.theme, `tema a ${width}`).toBe('dark');
    expect.soft(reading.body, `fondo a ${width}`).toBe(reading.token);
    expect.soft(reading.raw, `--bg a ${width}`).toBe(dark.raw);
  }

  // Tras entrar sigue oscuro y todavía no se ha guardado nada.
  await login(page, ACCOUNTS.coordinator);
  await expect(page).toHaveURL(/\/home$/);
  await expectTheme(page, 'dark', 'inicio');
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY), 'nada guardado tras entrar').toBeNull();
});

// ---- 2. Anchos: sin desborde, centrado y tope por tipo de página ---------------------------------------------------------------------

/** Tipo de página -> `max-width` calculado de su contenedor y su tope en píxeles (64rem, 80rem, sin tope, acceso y espera). */
const KINDS = {
  reading: { css: '1024px', cap: 1024 },
  list: { css: '1280px', cap: 1280 },
  map: { css: 'none', cap: Number.POSITIVE_INFINITY },
  access: { css: '480px', cap: 480 },
  waiting: { css: '608px', cap: 608 },
} as const;
type Kind = keyof typeof KINDS;

interface View {
  name: string;
  kind: Kind;
  /** Lleva la cabecera de la aplicación (las pantallas de acceso y de espera no). */
  shell?: boolean;
  open(page: Page): Promise<void>;
}

const at = (name: string, kind: Kind, path: string, shell = true): View => ({
  name,
  kind,
  shell,
  open: async (page) => {
    await page.goto(path);
  },
});

/** Abre el primer enlace de `/missions` o de `/routes` cuyo nombre coincide y deja la página de su detalle. */
const detailOf = (name: string, kind: Kind, listPath: string, link: RegExp | string): View => ({
  name,
  kind,
  shell: true,
  open: async (page) => {
    await page.goto(listPath);
    // La lista de misiones abre en «En planificación»: la misión de la semilla que se busca está en «Activas».
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const active = page.getByRole('tab', { name: es.missions.tabs.active, exact: true });
    if (await active.isVisible().catch(() => false)) await active.click();
    const target = page.getByRole('main').getByRole('link', { name: link }).first();
    await expect(target).toBeVisible();
    const href = await target.getAttribute('href');
    expect(href, `${name}: el enlace lleva a un detalle`).toMatch(new RegExp(`^${listPath}/`));
    await page.goto(href!);
  },
});

const ORDESA = /Valle de Ordesa/;
const PRADERA = 'Pradera a la Brecha (ficticia)';

const VIEWS = {
  coordinator: [
    at('Inicio', 'list', '/home'),
    at('Misiones', 'list', '/missions'),
    at('Crear misión', 'map', '/missions/new'),
    detailOf('Detalle de misión', 'map', '/missions', ORDESA),
    at('Rutas', 'map', '/routes'),
    detailOf('Detalle de ruta', 'map', '/routes', PRADERA),
    at('Dibujar ruta', 'map', '/routes/draw'),
    at('Importar ruta', 'map', '/routes/import'),
    at('Generar rutas', 'map', '/routes/generate'),
    at('Equipos', 'reading', '/teams'),
    at('Cuenta', 'reading', '/account'),
  ],
  admin: [
    at('Inicio', 'list', '/home'),
    at('Misiones', 'list', '/missions'),
    detailOf('Detalle de misión', 'map', '/missions', ORDESA),
    at('Rutas', 'map', '/routes'),
    at('Equipos', 'reading', '/teams'),
    at('Administración', 'reading', '/admin'),
    at('Cuenta', 'reading', '/account'),
  ],
  rescuer: [
    at('Mi perfil', 'reading', '/profile'),
    at('Mis misiones', 'list', '/missions'),
    detailOf('Detalle de misión', 'map', '/missions', ORDESA),
    at('Cuenta', 'reading', '/account'),
    at('Sin acceso (403)', 'reading', '/admin'),
    at('No encontrada (404)', 'reading', '/no-existe'),
  ],
} as const satisfies Record<string, View[]>;

interface Layout {
  /** Tramo en el que se centra el contenido: la ventana entera y, en el acceso desde 768 px, la columna del formulario (a la derecha de la portada). */
  lane: { left: number; right: number };
  width: number;
  scrollWidth: number;
  maxWidth: string;
  left: number;
  right: number;
  boxWidth: number;
  header: { left: number; right: number } | null;
}

const measureLayout = (page: Page): Promise<Layout> =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const main = document.querySelector('main')!.getBoundingClientRect();
    const header = document.querySelector('header')?.getBoundingClientRect();
    const brand = document.querySelector('.login-brand')?.getBoundingClientRect();
    const beside = brand !== undefined && brand.width < width; // portada a la izquierda (desde 768 px); en 375 px va encima
    const laneLeft = beside ? brand.right : 0;
    return {
      lane: { left: laneLeft, right: width },
      width,
      scrollWidth: document.documentElement.scrollWidth,
      maxWidth: getComputedStyle(document.querySelector('main')!).maxWidth,
      left: main.left - laneLeft,
      right: width - main.right,
      boxWidth: main.width,
      header: header ? { left: header.left, right: width - header.right } : null,
    };
  });

/** En cada ancho: sin desborde; el recuadro de la página mide lo que su tipo permite y queda centrado (±1 px); la cabecera llena el ancho. */
async function checkWidths(page: Page, view: View, where: string): Promise<void> {
  const kind = KINDS[view.kind];
  await expect(page.getByRole('heading', { level: 1 }).first(), `${where}: título`).toBeVisible();
  // La clase de la página (y con ella su tope) llega cuando termina de cargar: se espera a que el tope sea el de su tipo.
  await expect.poll(async () => (await measureLayout(page)).maxWidth, { message: `${where}: tope de ancho`, timeout: 20_000 }).toBe(kind.css);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    const here = `${where} a ${width} px`;
    await expectNoHorizontalOverflow(page);
    const layout = await measureLayout(page);
    expect.soft(layout.scrollWidth, `${here}: desborde horizontal`).toBeLessThanOrEqual(layout.width);
    const lane = layout.lane.right - layout.lane.left;
    const expected = Math.min(lane, kind.cap);
    expect.soft(Math.abs(layout.boxWidth - expected), `${here}: ancho del contenido ${layout.boxWidth} (esperado ${expected})`).toBeLessThanOrEqual(1);
    expect.soft(Math.abs(layout.left - layout.right), `${here}: centrado (izq. ${layout.left}, der. ${layout.right})`).toBeLessThanOrEqual(1);
    // Hueco por lado = lo que sobra al centrarlo (≤ 449 y 769 en lectura, ≤ 321 y 641 en listas, 0 en mapas, a 1920 y 2560 px).
    expect.soft(layout.left, `${here}: hueco izquierdo`).toBeLessThanOrEqual((lane - expected) / 2 + 1);
    expect.soft(layout.right, `${here}: hueco derecho`).toBeLessThanOrEqual((lane - expected) / 2 + 1);
    if (view.shell && layout.header) {
      expect.soft(layout.header.left, `${here}: cabecera, hueco izquierdo`).toBeLessThanOrEqual(1);
      expect.soft(layout.header.right, `${here}: cabecera, hueco derecho`).toBeLessThanOrEqual(1);
    }
  }
}

async function walk(page: Page, role: keyof typeof VIEWS, theme: 'dark' | 'light'): Promise<void> {
  for (const view of VIEWS[role]) {
    await page.setViewportSize({ width: 1280, height: HEIGHT });
    await view.open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await checkWidths(page, view, `${role} · ${view.name}`);
  }
}

/** Fija la preferencia guardada antes de que cargue ninguna página (equivale a haberla elegido en Cuenta: se prueba en el punto 4). */
const savePreference = (page: Page, value: 'dark' | 'light') => page.addInitScript(([key, preference]) => localStorage.setItem(key!, preference!), [THEME_STORAGE_KEY, value]);

test('coordinator: every view fits the five widths, centered and by page type (dark)', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await walk(page, 'coordinator', 'dark');
});

test('coordinator: the same in the light theme', async ({ page }) => {
  await savePreference(page, 'light');
  await login(page, ACCOUNTS.coordinator);
  await walk(page, 'coordinator', 'light');
});

test('administrator: every view fits the five widths, centered and by page type', async ({ page }) => {
  await login(page, ACCOUNTS.admin);
  await walk(page, 'admin', 'dark');
});

test('rescuer: every view fits the five widths, centered and by page type', async ({ page }) => {
  await login(page, ACCOUNTS.rescuer);
  await walk(page, 'rescuer', 'dark');
});

test('access and waiting screens fit the five widths and stay centered', async ({ page }) => {
  for (const view of [at('Acceso', 'access', '/login', false), at('Crear cuenta', 'access', '/register', false), at('Recuperar contraseña', 'access', '/forgot-password', false)]) {
    await page.setViewportSize({ width: 1280, height: HEIGHT });
    await view.open(page);
    await checkWidths(page, view, `público · ${view.name}`);
  }
  // La cuenta pendiente de la semilla ve la espera (no se toca: solo se lee).
  await login(page, ACCOUNTS.pending);
  await checkWidths(page, at('Espera', 'waiting', '/waiting', false), 'pendiente · Espera');
});

// ---- 3. Crear misión: alto del mapa --------------------------------------------------------------------------------------------------

/** Umbrales de `medidas.md` §6: columna por debajo de 1024 px (≥ 320 px y, donde se dice, ≥ 40 %), escritorio con el mapa llenando su caja. */
const MAP_CASES = [
  { width: 375, height: 812, column: true, ratio: 0.4 },
  { width: 375, height: 667, column: true, ratio: 0 },
  { width: 768, height: 1024, column: true, ratio: 0.4 },
  { width: 819, height: 614, column: true, ratio: 0 },
  { width: 1024, height: 768, column: false, ratio: 0.5 },
  { width: 1280, height: 720, column: false, ratio: 0.5 },
  { width: 1920, height: 1080, column: false, ratio: 0.7 },
  { width: 2560, height: 1440, column: false, ratio: 0.75 },
] as const;

test('create mission: the map is as tall as the thresholds ask, in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/missions/new');
  const region = page.getByRole('region', { name: es.createMission.mapRegion });
  await expect(region.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });

  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [THEME_STORAGE_KEY, theme]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(region.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });

    for (const size of MAP_CASES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      const here = `${theme} · ${size.width}×${size.height}`;
      await expectNoHorizontalOverflow(page);
      const measure = await region.evaluate((view) => {
        const canvas = view.querySelector('.map-canvas')!.getBoundingClientRect();
        // El mismo cálculo que `h1-demo.spec.ts`: lo que sobra del contenedor bajo sus hijos.
        const empty = view.clientHeight - [...view.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
        return { canvasHeight: canvas.height, empty, windowHeight: window.innerHeight };
      });
      const regionBox = (await region.boundingBox())!;
      const fieldBox = await page.getByLabel(es.createMission.name).boundingBox();
      expect.soft(measure.canvasHeight / measure.windowHeight, `${here}: alto del mapa (${measure.canvasHeight} px) respecto de la ventana`).toBeGreaterThanOrEqual(size.ratio);
      if (size.column) {
        expect.soft(measure.canvasHeight, `${here}: el mapa no baja de 20rem`).toBeGreaterThanOrEqual(320 - 0.5);
        // El mapa no tapa el primer campo del formulario: termina antes de donde empieza.
        expect.soft(fieldBox, `${here}: hay primer campo`).not.toBeNull();
        expect.soft(regionBox.y + regionBox.height, `${here}: el mapa termina antes del primer campo`).toBeLessThanOrEqual((fieldBox?.y ?? 0) + 0.5);
      } else {
        expect.soft(measure.empty, `${here}: hueco vacío bajo el mapa`).toBeLessThanOrEqual(1);
      }
    }
  }
});

// ---- 4. Cuenta: elegir el tema -------------------------------------------------------------------------------------------------------

test('Account: Light applies at once, survives a reload and a log out, and Dark brings it back', async ({ page }) => {
  await installThemeSpy(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1, name: es.account.title })).toBeVisible();
  const dark = await expectTheme(page, 'dark', 'cuenta, oscuro por defecto');
  await expect(themeRadio(page, es.account.themeDark)).toBeChecked();

  // «Claro» al momento (sin recargar).
  await themeRadio(page, es.account.themeLight).check();
  const light = await expectTheme(page, 'light', 'cuenta, al elegir Claro');
  expect(light.raw, 'el valor de --bg cambia con el tema').not.toBe(dark.raw);
  expect(light.body).not.toBe(dark.body);

  // Tras recargar, ya en DOMContentLoaded y sin pasar por el oscuro.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: es.account.title })).toBeVisible();
  await expectNoFlash(page, 'light', 'recarga');
  await expectTheme(page, 'light', 'recarga');
  await expect(themeRadio(page, es.account.themeLight)).toBeChecked();

  // Tras cerrar sesión, el acceso sale en claro (la preferencia es del navegador, no de la sesión).
  await page.getByRole('button', { name: es.account.logout }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expectTheme(page, 'light', 'acceso tras cerrar sesión');
  await login(page, ACCOUNTS.coordinator);
  await expectTheme(page, 'light', 'inicio tras entrar de nuevo');

  // Vuelta a «Oscuro»: al momento y tras recargar.
  await page.goto('/account');
  await themeRadio(page, es.account.themeDark).check();
  const back = await expectTheme(page, 'dark', 'cuenta, al volver a Oscuro');
  expect(back.raw).toBe(dark.raw);
  await page.reload();
  await expectNoFlash(page, 'dark', 'recarga en oscuro');
  await expectTheme(page, 'dark', 'recarga en oscuro');
});

test('Account: "Like the system" follows prefers-color-scheme live and after a reload, and an explicit choice beats the system', async ({ page }) => {
  await installThemeSpy(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/account');
  await themeRadio(page, es.account.themeSystem).check();
  await expect(themeRadio(page, es.account.themeSystem)).toBeChecked();
  await expectTheme(page, 'dark', 'sistema oscuro');

  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light', 'el sistema pasa a claro, en vivo');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark', 'el sistema vuelve a oscuro, en vivo');

  // Tras recargar sigue al sistema, sin destello.
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light', 'el sistema en claro');
  await page.reload();
  await expectNoFlash(page, 'light', 'recarga con el sistema en claro');
  await expect(themeRadio(page, es.account.themeSystem)).toBeChecked();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expectNoFlash(page, 'dark', 'recarga con el sistema en oscuro');

  // Con una elección explícita, el sistema ya no manda.
  await themeRadio(page, es.account.themeDark).check();
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark', 'Oscuro explícito con el sistema en claro');
  await themeRadio(page, es.account.themeLight).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'light', 'Claro explícito con el sistema en oscuro');
});

test('Account in French at 375 px works with the keyboard only: Light, reload, system, Dark and log out', async ({ page }) => {
  const key = (name: string) => page.keyboard.press(name);
  await installThemeSpy(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });

  // El idioma se elige en el propio acceso, con el teclado.
  await page.goto('/login');
  await expect(page.getByRole('button', { name: es.login.submit })).toBeVisible();
  // (Tab llega a la opción marcada del grupo, «Español»; la flecha pasa a «Français».)
  await tabTo(page, page.getByRole('radio', { name: es.account.languageEs, exact: true }));
  await key('ArrowRight');
  await expect(page.getByRole('radio', { name: es.account.languageFr, exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: fr.login.submit })).toBeVisible();

  await tabTo(page, page.getByLabel(fr.login.email));
  await page.keyboard.type(ACCOUNTS.coordinatorFr.email);
  await key('Tab');
  await expect(page.getByLabel(fr.login.password)).toBeFocused();
  await page.keyboard.type(ACCOUNTS.coordinatorFr.password);
  await key('Enter');
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));

  // A la vista Compte por el menú plegado del móvil.
  await tabTo(page, page.getByRole('button', { name: fr.nav.menu, exact: true }));
  await key('Enter');
  const account = page.getByRole('navigation', { name: fr.nav.label }).getByRole('link', { name: fr.nav.account, exact: true });
  await tabTo(page, account);
  await key('Enter');
  await expect(page.getByRole('heading', { level: 1, name: fr.account.title })).toBeVisible();
  await expect(page.getByRole('group', { name: fr.account.theme })).toBeVisible();

  // Sombre -> Clair con la flecha: al momento.
  await expectTheme(page, 'dark', 'compte, sombre');
  await tabTo(page, themeRadio(page, fr.account.themeDark));
  await key('ArrowRight');
  await expect(themeRadio(page, fr.account.themeLight)).toBeFocused();
  await expect(themeRadio(page, fr.account.themeLight)).toBeChecked();
  await expectTheme(page, 'light', 'compte, clair');
  await expectNoHorizontalOverflow(page);
  // Las tres opciones caben en el ancho y miden el alto de control como mínimo (40 px con puntero fino, D-S8 de UI-simplificacion).
  for (const label of [fr.account.themeDark, fr.account.themeLight, fr.account.themeSystem]) {
    const box = await page.getByLabel(label, { exact: true }).locator('xpath=ancestor::label').boundingBox();
    expect(box, label).not.toBeNull();
    expect(box!.height, `${label}: alto`).toBeGreaterThanOrEqual(39.5);
    expect(box!.x, `${label}: dentro de la pantalla`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${label}: dentro de la pantalla`).toBeLessThanOrEqual(375.5);
  }

  // Tras recargar sigue claro, sin destello, y el teclado vuelve a llegar al grupo.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: fr.account.title })).toBeVisible();
  await expectNoFlash(page, 'light', 'recarga en francés');
  await expectTheme(page, 'light', 'recarga en francés');

  // Comme le système: la flecha lo marca y el sistema manda, en vivo.
  await tabTo(page, themeRadio(page, fr.account.themeLight));
  await key('ArrowRight');
  await expect(themeRadio(page, fr.account.themeSystem)).toBeChecked();
  await expectTheme(page, 'dark', 'sistema oscuro');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light', 'el sistema pasa a claro');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark', 'el sistema vuelve a oscuro');

  // Dos flechas atrás -> Sombre explícito; con el sistema en claro se queda oscuro.
  await key('ArrowLeft');
  await expect(themeRadio(page, fr.account.themeLight)).toBeChecked();
  await key('ArrowLeft');
  await expect(themeRadio(page, fr.account.themeDark)).toBeChecked();
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark', 'Sombre explícito con el sistema en claro');

  // Cerrar sesión con el teclado: el acceso sigue en francés y oscuro.
  await tabTo(page, page.getByRole('button', { name: fr.account.logout }));
  await key('Enter');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: fr.login.submit })).toBeVisible();
  await expectTheme(page, 'dark', 'acceso tras cerrar sesión');
  await expectNoHorizontalOverflow(page);
});

// ---- 5. Mapa: el tema entra por setStyle y el lienzo no se recrea --------------------------------------------------------------------

interface Paint {
  /** Luminancia (0 a 1) del color de fondo dominante en la parte central del lienzo. */
  backgroundLuminance: number;
  /** Píxeles de esa parte que no son del fondo: el trazo de las rutas y su borde. */
  marks: number;
}

/** Captura el lienzo y mide lo pintado en su parte central, en una página en blanco (la de la aplicación tiene CSP). */
async function readPaint(probe: Page, canvas: Locator): Promise<Paint> {
  const png = (await canvas.screenshot()).toString('base64');
  return probe.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const x0 = Math.floor(bitmap.width * 0.25);
    const y0 = Math.floor(bitmap.height * 0.25);
    const w = Math.floor(bitmap.width * 0.5);
    const h = Math.floor(bitmap.height * 0.5);
    const { data } = context.getImageData(x0, y0, w, h);
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const packed = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      counts.set(packed, (counts.get(packed) ?? 0) + 1);
    }
    let mode = 0;
    let best = -1;
    for (const [packed, count] of counts) {
      if (count > best) {
        best = count;
        mode = packed;
      }
    }
    const [r, g, b] = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255];
    let marks = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(Math.abs(data[i]! - r), Math.abs(data[i + 1]! - g), Math.abs(data[i + 2]! - b)) > 48) marks += 1;
    }
    const linear = (value: number) => (value / 255) ** 2.2;
    return { backgroundLuminance: 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b), marks };
  }, png);
}

test('library with the roads layer: dark.json then light.json, the same canvas and the routes still painted', async ({ page }) => {
  const sprites: string[] = [];
  page.on('request', (request) => {
    const match = /\/sprites\/v4\/(dark|light)\.json$/.exec(new URL(request.url()).pathname);
    if (match) sprites.push(match[1]!);
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const probe = await page.context().newPage();
  await probe.goto('about:blank');

  await login(page, ACCOUNTS.coordinator);
  // «Como el sistema»: así el tema cambia con el mapa abierto (emulando `prefers-color-scheme`), sin salir de la página.
  await page.goto('/account');
  await themeRadio(page, es.account.themeSystem).check();
  await expectTheme(page, 'dark', 'cuenta, sistema oscuro');

  await page.getByRole('navigation', { name: es.nav.label }).getByRole('link', { name: es.nav.routes, exact: true }).click();
  await expect(page).toHaveURL(/\/routes$/);
  for (const name of [PRADERA, 'Senda del Circo (ficticia)', 'Collado con borrador nuevo (ficticia)']) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  const mapRegion = page.getByRole('region', { name: es.routes.map.label });
  const roads = mapLayerButton(mapRegion, es.map.layers.roads);
  await expect(mapLayerButton(mapRegion)).toBeVisible({ timeout: 30_000 });
  await chooseMapLayer(mapRegion, es.map.layers.roads);
  const canvas = mapRegion.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // En oscuro se pide el sprite oscuro (y ninguno claro).
  await expect.poll(() => sprites, { message: 'sprite oscuro pedido', timeout: 20_000 }).toContain('dark');
  expect(sprites, 'ningún sprite claro con el sistema en oscuro').not.toContain('light');
  const canvasNode = await canvas.elementHandle();
  expect(canvasNode).not.toBeNull();
  const sameCanvas = () =>
    canvasNode!.evaluate(
      (node) => node.isConnected && node === document.querySelector('.map-view canvas.maplibregl-canvas') && document.querySelectorAll('.map-view canvas.maplibregl-canvas').length === 1,
    );
  const painted = async (check: (paint: Paint) => boolean, message: string) => {
    let last: Paint | null = null;
    await expect
      .poll(
        async () => {
          last = await readPaint(probe, canvas);
          return check(last);
        },
        { message, timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    return last as unknown as Paint;
  };
  const MIN_MARKS = 150;
  const onDark = await painted((paint) => paint.backgroundLuminance < 0.15 && paint.marks >= MIN_MARKS, 'mapa oscuro con las rutas pintadas');

  // Al pasar a claro: sprite claro, el mismo lienzo, fondo claro y las rutas siguen ahí.
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'light', 'el sistema pasa a claro');
  await expect.poll(() => sprites, { message: 'sprite claro pedido', timeout: 20_000 }).toContain('light');
  expect(await sameCanvas(), 'el lienzo es el mismo nodo tras pasar a claro').toBe(true);
  const onLight = await painted((paint) => paint.backgroundLuminance > 0.3 && paint.marks >= MIN_MARKS, 'mapa claro con las rutas pintadas');
  expect(onLight.backgroundLuminance, 'el fondo del mapa se aclara').toBeGreaterThan(onDark.backgroundLuminance);
  await expect(roads, 'la capa elegida sigue elegida').toBeVisible();

  // Y de vuelta a oscuro: otra petición del sprite oscuro, otra vez el mismo lienzo.
  const darkRequests = sprites.filter((name) => name === 'dark').length;
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark', 'el sistema vuelve a oscuro');
  await expect.poll(() => sprites.filter((name) => name === 'dark').length, { message: 'sprite oscuro pedido otra vez', timeout: 20_000 }).toBeGreaterThan(darkRequests);
  expect(await sameCanvas(), 'el lienzo es el mismo nodo tras volver a oscuro').toBe(true);
  await painted((paint) => paint.backgroundLuminance < 0.15 && paint.marks >= MIN_MARKS, 'mapa oscuro otra vez con las rutas pintadas');
  await expect(mapRegion.getByText(/OpenStreetMap/)).toBeVisible(); // la atribución del mapa base sigue a la vista

  // Elección explícita: «Claro» en Cuenta y, al entrar en la biblioteca, el mapa nace con el sprite claro.
  const lightRequests = sprites.filter((name) => name === 'light').length;
  await page.getByRole('navigation', { name: es.nav.label }).getByRole('link', { name: es.nav.account, exact: true }).click();
  await themeRadio(page, es.account.themeLight).check();
  await page.getByRole('navigation', { name: es.nav.label }).getByRole('link', { name: es.nav.routes, exact: true }).click();
  await expect(mapLayerButton(mapRegion)).toBeVisible({ timeout: 30_000 });
  await chooseMapLayer(mapRegion, es.map.layers.roads);
  await expect.poll(() => sprites.filter((name) => name === 'light').length, { message: 'sprite claro pedido al entrar', timeout: 20_000 }).toBeGreaterThan(lightRequests);
});
