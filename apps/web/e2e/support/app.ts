import { expect, type Locator, type Page } from '@playwright/test';
import { es, fr } from '@onway/i18n';
import { DEMO_PASSWORD } from './stack';

export { es, fr };

/** Cuentas de la demostración (data/seed/README.md). Todas comparten la contraseña ficticia pública. */
export const ACCOUNTS = {
  admin: { email: 'admin@example.org', password: DEMO_PASSWORD },
  coordinator: { email: 'coordinador@example.org', password: DEMO_PASSWORD },
  coordinatorFr: { email: 'coordinatrice@example.org', password: DEMO_PASSWORD },
  rescuer: { email: 'rescatista1@example.org', password: DEMO_PASSWORD },
  pending: { email: 'pendiente@example.org', password: DEMO_PASSWORD },
} as const;

export interface Credentials {
  email: string;
  password: string;
}

/** Inicia sesión por el formulario, como lo haría una persona, y espera a llegar a la primera pantalla. */
export async function login(page: Page, who: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(es.login.email).fill(who.email);
  await page.getByLabel(es.login.password).fill(who.password);
  await page.getByRole('button', { name: es.login.submit }).click();
  // Hasta que la web sale del acceso: sin esto, lo que se haga después puede cruzarse con la redirección.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

/** En móvil la barra está plegada tras el botón «Menú»; en escritorio siempre está a la vista. */
export async function openMenuIfCollapsed(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: es.nav.menu, exact: true });
  if (await button.isVisible()) await button.click();
}

/** Los textos de los enlaces de la barra principal, en orden. */
export async function navLabels(page: Page): Promise<string[]> {
  await openMenuIfCollapsed(page);
  const nav = page.getByRole('navigation', { name: es.nav.label });
  await expect(nav).toBeVisible();
  return nav.getByRole('link').allInnerTexts();
}

/** La página no se desborda en horizontal (nada obliga a desplazarse de lado). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth} en ${page.url()}`).toBeLessThanOrEqual(clientWidth);
}

/** El botón de capas del mapa (UI-simplificacion, D-S6): su nombre dice la capa vigente. Sin `layer`, cualquiera. */
export const mapLayerButton = (map: Locator, layer?: string): Locator =>
  map.getByRole('button', { name: layer ? es.map.layers.current.replace('{{layer}}', layer) : new RegExp(`^${es.map.layers.label}`), exact: true });

/** Abre el desplegable de capas del mapa, elige una y espera a que el botón la nombre. */
export async function chooseMapLayer(map: Locator, layer: string): Promise<void> {
  await mapLayerButton(map).click();
  await map.getByRole('menuitemradio', { name: layer, exact: true }).click();
  await expect(mapLayerButton(map, layer)).toBeVisible();
}

export const heading = (page: Page, name: string): Locator => page.getByRole('heading', { level: 1, name });

// PNG transparente de 1×1: las teselas de IGN se sustituyen por él para que estas pruebas no salgan a Internet (D-H1-15).
export const BLANK_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Responde con una tesela vacía a los servicios de mapa de terceros (IGN) y deja pasar todo lo demás. */
export async function stubMapTiles(page: Page): Promise<void> {
  await page.route(/^https:\/\/(www\.ign\.es|data\.geopf\.fr)\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE }));
}
