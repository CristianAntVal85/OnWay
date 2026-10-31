// Apoyo de la demostración de H1 (doc 07 §3, plan §6): contextos del navegador que reproducen el proyecto en curso (escritorio o
// móvil de 375 px), teclado y una vigilancia de red que comprueba que NINGUNA petición sale a un dominio que no sea el propio
// origen o los servicios de mapa de IGN (D-H1-08). Las teselas de IGN se sustituyen por una imagen vacía: el E2E no sale a Internet.
import { devices, expect, test as base, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page, type TestInfo } from '@playwright/test';
import { BLANK_TILE, es, expectNoHorizontalOverflow, login, type Credentials } from './app';

export { es, expectNoHorizontalOverflow, login };

/** Los únicos anfitriones de terceros que puede pedir el navegador (apps/web/src/map/ign.ts y la CSP de Caddy). */
export const IGN_HOSTS: readonly string[] = ['www.ign.es', 'data.geopf.fr'];
const IGN_URL = /^https:\/\/(www\.ign\.es|data\.geopf\.fr)\//;

/** Una ubicación ficticia del dispositivo, con decimales de más a propósito: la web debe redondearla a la celda de ~1 km (INV-30). */
export const DEVICE_AT = { latitude: 42.63412, longitude: 0.11487 } as const;
/** Lo que debe llegar a `getEnvironment` para esa ubicación. */
export const DEVICE_CELL = { lat: '42.63', lon: '0.11' } as const;
/** Celda para la que `providers-stub` responde 503 al tiempo (latitud 41.99): prueba la degradación. */
export const DEVICE_DOWN = { latitude: 41.99, longitude: 0.5 } as const;

/** Anota a qué anfitriones pide el navegador y deja pasar solo lo propio; las teselas de IGN las responde una imagen vacía. */
export class NetworkWatch {
  readonly hosts = new Map<string, number>();

  async attach(context: BrowserContext): Promise<void> {
    await context.route(IGN_URL, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE }));
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // data:, blob:... no salen del navegador
      this.hosts.set(url.host, (this.hosts.get(url.host) ?? 0) + 1);
    });
  }

  /** Anfitriones pedidos que no son el propio ni los de IGN. */
  foreign(ownHost: string): string[] {
    return [...this.hosts.keys()].filter((host) => host !== ownHost && !IGN_HOSTS.includes(host));
  }

  /** Cuántas peticiones de mapa de IGN se han visto (prueba que la vigilancia alcanza también a las teselas). */
  get ignRequests(): number {
    return IGN_HOSTS.reduce((sum, host) => sum + (this.hosts.get(host) ?? 0), 0);
  }
}

interface Fixtures {
  network: NetworkWatch;
  /** Un contexto nuevo (otra sesión) con el mismo formato de pantalla que el proyecto en curso. */
  roleContext: (extra?: BrowserContextOptions) => Promise<BrowserContext>;
}

function projectDevice(info: TestInfo): BrowserContextOptions {
  const base = info.project.name === 'mobile' ? { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } } : devices['Desktop Chrome'];
  return { ...base, baseURL: info.project.use.baseURL ?? 'http://localhost:8080', locale: 'es-ES' };
}

export const test = base.extend<Fixtures>({
  network: [
    async ({ context, baseURL }, use) => {
      const watch = new NetworkWatch();
      await watch.attach(context);
      await use(watch);
      expect(watch.foreign(new URL(baseURL ?? 'http://localhost:8080').host), 'peticiones a dominios ajenos').toEqual([]);
    },
    { auto: true },
  ],
  roleContext: async ({ browser, network }, use, info) => {
    const opened: BrowserContext[] = [];
    await use(async (extra = {}) => {
      const context: BrowserContext = await (browser as Browser).newContext({ ...projectDevice(info), ...extra });
      // Las peticiones de este contexto cuentan en la misma vigilancia (y las teselas de IGN se sustituyen igual).
      await context.route(IGN_URL, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE }));
      context.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol === 'http:' || url.protocol === 'https:') network.hosts.set(url.host, (network.hosts.get(url.host) ?? 0) + 1);
      });
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },
});

export { expect };

/** Inicia sesión en un contexto nuevo y devuelve su página. */
export async function openSession(open: Fixtures['roleContext'], who: Credentials, extra?: BrowserContextOptions): Promise<Page> {
  const context = await open(extra);
  const page = await context.newPage();
  await login(page, who);
  return page;
}

/** Pulsa Tab hasta que el foco llega al elemento (el teclado es el único medio de llegar). */
export async function tabTo(page: Page, target: Locator, max = 90): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Pincha el centro del lienzo del mapa de una región del mapa. */
export async function clickMapCenter(region: Locator): Promise<void> {
  const canvas = region.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  await canvas.click();
}

/** El elemento cabe en el ancho de la pantalla (nada queda recortado a los lados). */
export async function expectWithinViewportWidth(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box, 'el elemento tiene caja').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
}
