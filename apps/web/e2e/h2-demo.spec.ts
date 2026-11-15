// Demostración de H2 (doc 07 §3, plan §6) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// El coordinador abre Rutas y ve las de la semilla en lista y mapa, mueve el mapa y la lista se filtra, filtra y busca; importa un GPX
// inventado con altitudes falsas y ve la vista previa con las métricas recalculadas; lo guarda en Borrador, edita y crea la versión 2,
// las compara, valida la 2, deriva una copia, exporta varias rutas y una versión, la vuelve a importar y obtiene la misma geometría,
// archiva una ruta e importa puntos en una misión. El administrador ve la biblioteca sin botones de escritura y el rescatista «Sin acceso».
// Todo es ficticio: los GPX salen de data/seed/gpx (inventados), el terreno es el DEM sintético y las teselas de IGN, una imagen vacía.
// Cada ejecución crea sus rutas con nombre único («E2E …») y las deja ARCHIVADAS (RN-14; la demostración de la issue #17 es la que elimina), y una misión «E2E …»
// que queda cerrada; si una ejecución se interrumpe, la preparación y el cierre las recogen.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { ACCOUNTS, chooseMenuItem, fr, menuItemNames } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, openSession, tabTo, test } from './support/demo';
import { ROOT } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);
const GPX = (name: string) => path.join(ROOT, 'data/seed/gpx', name);
const R = es.routes;
const D = es.routeDetail;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = { base: '', routeId: '', copyId: '', reimportId: '', exported: '', missionId: '' };
const nameOf = (info: { project: { name: string } }, label: string) => `E2E ${info.project.name} ${STAMP} ${label}`;

const card = (page: Page, text: string) => page.locator('.route-card', { hasText: text });
const mobile = (info: { project: { name: string } }) => info.project.name === 'mobile';

/** Lee la API con la sesión del navegador (solo lecturas: no necesitan CSRF). */
async function apiGet<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(`/api/v1${url}`);
  expect(response.status(), url).toBe(200);
  return (await response.json()) as T;
}
async function apiPost<T>(page: Page, url: string, body: unknown): Promise<T> {
  const me = await apiGet<{ csrfToken: string }>(page, '/auth/me');
  const response = await page.request.post(`/api/v1${url}`, { data: body, headers: { 'X-CSRF-Token': me.csrfToken } });
  expect(response.status(), url).toBeLessThan(300);
  return (await response.json()) as T;
}
const idFromUrl = (page: Page) => page.url().split('?')[0]!.split('/').pop()!;

test('the coordinator sees the demo library in list and map, the list follows the map and the filters narrow it', async ({ page }, info) => {
  run.base = nameOf(info, '');
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/routes');
  await expect(page.getByRole('heading', { level: 1, name: R.title })).toBeVisible();

  for (const name of [
    'Pradera a la Brecha (ficticia)',
    'Senda del Circo (ficticia)',
    'Collado con borrador nuevo (ficticia)',
    'Variante de la Pradera (ficticia)',
    'Pista con validación antigua (ficticia)',
  ]) {
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // Lo que enseña cada tarjeta: estado de la última versión, validación antigua y copia.
  await expect(card(page, 'Collado con borrador nuevo')).toContainText(R.card.draft);
  await expect(card(page, 'Pista con validación antigua')).toContainText(R.card.stale);
  await expect(card(page, 'Variante de la Pradera')).toContainText(R.card.copy);
  await expect(card(page, 'Camino antiguo')).toHaveCount(0); // la archivada no sale entre las activas
  await expectNoHorizontalOverflow(page);

  // Dos formatos: escritorio con lista y mapa a la vez; móvil con dos pestañas.
  const mapRegion = page.getByRole('region', { name: R.map.label });
  if (mobile(info)) {
    await expect(mapRegion).toBeHidden();
    await page.getByRole('tab', { name: R.views.map }).click();
    await expect(page.getByRole('tab', { name: R.views.map })).toHaveAttribute('aria-selected', 'true');
  }
  // El mapa se carga aparte (MapLibre es un trozo propio): en el CI, con la pila ocupada, puede tardar más de los 5 s por defecto.
  await expect(mapRegion).toBeVisible({ timeout: 30_000 });
  const canvas = mapRegion.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // Mover el mapa (arrastrarlo) filtra la lista por la zona visible: la petición lleva `bbox`.
  // Con la pila cargada el primer arrastre puede perderse mientras el mapa termina de pintar: se repite hasta que la lista pide la zona.
  const box = (await canvas.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let asked = false;
  for (let attempt = 0; attempt < 4 && !asked; attempt += 1) {
    const bboxRequest = page
      .waitForRequest((request) => request.url().includes('/api/v1/routes?') && request.url().includes('bbox='), { timeout: 6000 })
      .then(
        () => true,
        () => false,
      );
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 60 + attempt * 20, centre.y + 40, { steps: 8 });
    await page.mouse.up();
    asked = await bboxRequest;
  }
  expect(asked, 'la lista pide la zona visible del mapa').toBe(true);
  await page.waitForTimeout(1000); // el mapa termina su inercia antes de quitar la zona
  if (mobile(info)) await page.getByRole('tab', { name: R.views.list }).click();
  await expect(page.getByRole('button', { name: R.zone.clear })).toBeVisible();
  // «Mostrar toda la biblioteca» quita la zona. La inercia del arrastre puede seguir moviendo el mapa unos instantes en el CI y volver a
  // pedirla, así que se comprueba el botón y, para seguir con los filtros, se vuelve a abrir la página (la zona no vive en la dirección).
  await page.getByRole('button', { name: R.zone.clear }).click();
  await page.goto('/routes');
  await expect(page.getByRole('link', { name: 'Pradera a la Brecha (ficticia)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: R.zone.clear })).toHaveCount(0);

  // Filtrar por estado y buscar por nombre.
  await page.getByText(new RegExp(`^${R.filters.title}`)).click();
  await page.getByLabel(R.filters.status).selectOption('archived');
  // Las rutas «E2E …» de ejecuciones anteriores también están archivadas: se busca por nombre.
  await page.getByLabel(R.searchLabel).fill('Camino antiguo');
  await expect(page).toHaveURL(/[?&]q=Camino/); // la búsqueda ya está aplicada (con otra lista antes, la tarjeta podría verse sin ella)
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Camino antiguo (ficticia)', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pradera a la Brecha (ficticia)', exact: true })).toHaveCount(0);
  await page.getByLabel(R.searchLabel).fill('');
  await expect(page).not.toHaveURL(/[?&]q=/);
  await page.getByLabel(R.filters.status).selectOption('active');
  await page.getByLabel(R.filters.version).selectOption('draft');
  await expect(page.getByRole('link', { name: 'Variante de la Pradera (ficticia)', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: R.filters.clear }).click();
  await page.getByLabel(R.searchLabel).fill('Circo');
  await expect(page.locator('.route-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true })).toBeVisible();
});

test('importing a GPX with false altitudes previews the server’s metrics and saves a Draft', async ({ page }, info) => {
  run.routeId = '';
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/routes');
  await page.getByRole('link', { name: R.importCta }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: es.routeImport.title })).toBeVisible();

  // Un archivo de más de 10 MB se rechaza sin subirlo.
  await page.getByLabel(es.routeImport.fileLabel).setInputFiles({ name: 'enorme.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32) });
  await page.getByRole('button', { name: es.routeImport.submit }).click();
  await expect(page.getByText(es.routeImport.tooLarge)).toBeVisible();
  // Un PDF que se llama .gpx lo rechaza el servidor por su contenido.
  await page.getByLabel(es.routeImport.fileLabel).setInputFiles({ name: 'informe.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from('%PDF-1.7 ficticio') });
  await page.getByRole('button', { name: es.routeImport.submit }).click();
  await expect(page.getByText(es.errors.UNSUPPORTED_FILE_TYPE)).toBeVisible();

  await page.getByLabel(es.routeImport.fileLabel).setInputFiles(GPX('ejemplo-importar.gpx'));
  await page.getByRole('button', { name: es.routeImport.submit }).click();
  await expect(page.getByText(es.routeImport.previewNothingSaved)).toBeVisible();
  await expect(page.getByText(es.routeImport.warnings.elevation_recomputed)).toBeVisible();
  await expect(page.getByText(es.routeImport.warnings.waypoints_ignored)).toBeVisible();
  // La altitud falsa del archivo (999 m en todos los puntos) no llega: la máxima es la del terreno del servidor.
  const panel = page.locator('.editor-panel');
  const maxElevation = panel.locator('dt', { hasText: D.metrics.maxElevation }).locator('xpath=following-sibling::dd[1]');
  await expect(maxElevation).not.toHaveText(/^999 m$/);
  await expectNoHorizontalOverflow(page);

  const name = nameOf(info, 'importada');
  await page.getByLabel(es.routeImport.nameLabel).fill(name);
  await page.getByRole('button', { name: es.routeImport.save }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  run.routeId = idFromUrl(page);
  expect(run.routeId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('.version-row')).toHaveCount(1);
  await expect(page.locator('.version-row')).toContainText(D.versions.draft);
  await expect(page.locator('.version-row')).toContainText(D.versions.provenance.imported);
  await expect(page.getByRole('img', { name: new RegExp(D.profile.title) })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('editing creates version 2, comparing shows both, and validating version 2 makes it immutable', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/routes/${run.routeId}`);
  const distanceBefore = await page.locator('dt', { hasText: D.metrics.distance }).first().locator('xpath=following-sibling::dd[1]').innerText();
  await page.getByRole('link', { name: D.actions.edit, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^Nueva versión de`) })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Sin ratón: se cambia una coordenada escribiéndola.
  const lat = page.getByLabel(es.routeEditor.latLabel.replace('{{n}}', '2'), { exact: true });
  const before = await lat.inputValue();
  await lat.fill(String(Number(before) + 0.004));
  await lat.press('Enter');
  await expect(lat).toHaveValue(String(Number(before) + 0.004));
  await page.getByLabel(es.routeEditor.noteLabel).fill('Vértice movido a mano');

  if (!mobile(info)) {
    // Con ratón: se arrastra el primer vértice.
    const handle = page.locator('.vertex-handle').first();
    await handle.scrollIntoViewIfNeeded();
    const first = page.getByLabel(es.routeEditor.latLabel.replace('{{n}}', '1'), { exact: true });
    const start = await first.inputValue();
    // El mapa del editor encuadra la ruta (animación de 600 ms) cuando termina de cargar, y con la máquina ocupada eso llega DESPUÉS de que
    // exista el vértice: se midió el vértice moviéndose 357 px entre dos lecturas seguidas de su caja. Se lee la caja en cada intento y,
    // si el arrastre cayó donde el vértice ya no estaba, se repite (sin mover nada más: un arrastre en vacío solo desplaza el mapa).
    await expect(async () => {
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 6 });
      await page.mouse.up();
      await expect(first).not.toHaveValue(start, { timeout: 4000 });
    }).toPass({ timeout: 25_000 });
    // Deshacer vuelve al valor anterior.
    await page.getByRole('button', { name: es.routeEditor.undo }).click();
    await expect(first).toHaveValue(start);
  }

  await page.getByRole('button', { name: es.routeEditor.saveVersion }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(run.base.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  await expect(page.locator('.version-row')).toHaveCount(2);
  await expect(page.locator('.version-row').first()).toContainText(D.versions.number.replace('{{number}}', '2'));
  await expect(page.locator('.version-row').first()).toContainText(D.versions.manuallyModified);
  // La versión 1 sigue igual.
  await page.getByRole('button', { name: D.versions.show.replace('{{number}}', '1') }).click();
  await expect(page.locator('dt', { hasText: D.metrics.distance }).first().locator('xpath=following-sibling::dd[1]')).toHaveText(distanceBefore);
  await page.getByRole('button', { name: D.versions.show.replace('{{number}}', '2') }).click();

  // Comparar las dos: dos líneas en el mapa y la tabla con la diferencia.
  await page.getByRole('button', { name: D.compare.start }).click();
  await expect(page.getByRole('heading', { name: D.compare.title })).toBeVisible();
  const table = page.locator('.compare-table');
  await expect(table.getByRole('rowheader', { name: D.metrics.distance })).toBeVisible();
  await expect(table.locator('thead')).toContainText(D.compare.difference);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: D.compare.stop }).click();

  // Validar la versión 2: el aviso se acepta con la casilla.
  await page.getByRole('button', { name: D.actions.validate, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: D.validate.title.replace('{{number}}', '2') });
  await expect(dialog.getByText(D.validate.warning)).toBeVisible();
  await dialog.getByRole('button', { name: D.validate.confirm }).click();
  await expect(dialog.getByText(D.validate.needsAcknowledge)).toBeVisible();
  await dialog.getByRole('checkbox', { name: D.validate.acknowledge }).check();
  await dialog.getByRole('button', { name: D.validate.confirm }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.version-row').first()).toContainText(D.versions.validated);
  await expect(page.getByRole('button', { name: D.actions.validate, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: D.actions.edit, exact: true })).toBeVisible();
});

test('deriving makes a copy that remembers where it comes from, and several routes export in one file', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/routes/${run.routeId}`);
  await chooseMenuItem(page, es.common.more, D.actions.duplicate);
  const dialog = page.getByRole('dialog', { name: D.derive.title });
  const copyName = nameOf(info, 'copia');
  await dialog.getByLabel(D.derive.nameLabel).fill(copyName);
  await dialog.getByRole('button', { name: D.derive.confirm }).click();
  await expect(page.getByRole('heading', { level: 1, name: copyName })).toBeVisible();
  run.copyId = idFromUrl(page);
  await expect(page.getByRole('link', { name: /^Deriva de «E2E .*importada» \(versión 2\)$/ })).toBeVisible();

  // Biblioteca: se buscan las dos, se seleccionan y se exportan juntas.
  await page.goto('/routes');
  await page.getByLabel(R.searchLabel).fill(run.base.trim());
  await expect(page.locator('.route-card')).toHaveCount(2);
  for (const link of await page.locator('.route-card-check').all()) await link.check();
  await expect(page.getByText(R.selection.count.replace('{{count}}', '2'))).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: R.selection.exportGpx }).click()]);
  const text = await readFile((await download.path())!, 'utf8');
  expect(text.match(/<trk>/g)).toHaveLength(2);
  expect(text).not.toMatch(/<author|<email|@/);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
});

test('exporting a version and importing it again gives the same geometry', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/routes/${run.routeId}`);
  const [download] = await Promise.all([page.waitForEvent('download'), chooseMenuItem(page, es.common.export, D.actions.exportGpx)]);
  run.exported = (await download.path())!;

  await page.goto('/routes/import');
  await page.getByLabel(es.routeImport.fileLabel).setInputFiles(run.exported);
  await page.getByRole('button', { name: es.routeImport.submit }).click();
  await expect(page.getByText(es.routeImport.previewNothingSaved)).toBeVisible();
  await page.getByLabel(es.routeImport.nameLabel).fill(nameOf(info, 'reimportada'));
  await page.getByRole('button', { name: es.routeImport.save }).click();
  await expect(page.getByRole('heading', { level: 1, name: nameOf(info, 'reimportada') })).toBeVisible();
  run.reimportId = idFromUrl(page);

  const geometryOf = async (routeId: string, number: number) => {
    const detail = await apiGet<{ versions: { id: string; number: number }[] }>(page, `/routes/${routeId}`);
    const version = detail.versions.find((v) => v.number === number)!;
    return apiGet<{ geometry: { coordinates: number[][] }; metrics: unknown }>(page, `/routes/${routeId}/versions/${version.id}`);
  };
  const original = await geometryOf(run.routeId, 2);
  const again = await geometryOf(run.reimportId, 1);
  expect(again.geometry.coordinates).toEqual(original.geometry.coordinates);
  expect(again.metrics).toEqual(original.metrics);
});

test('a route is archived and then it is read-only', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/routes/${run.reimportId}`);
  await chooseMenuItem(page, es.common.more, D.actions.archive);
  const dialog = page.getByRole('dialog', { name: D.archive.title });
  await dialog.getByRole('button', { name: D.archive.confirm }).click();
  await expect(page.getByText(D.archivedNotice)).toBeVisible();
  await expect(page.getByRole('link', { name: D.actions.edit, exact: true })).toHaveCount(0);
  expect(await menuItemNames(page, es.common.more)).toEqual([D.actions.duplicate]);
});

test('points of a GPX are imported into a mission', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  const name = nameOf(info, 'misión');
  const mission = await apiPost<{ id: string }>(page, '/missions', { name, target: { source: 'map', lat: 42.67, lon: 0.03 } });
  run.missionId = mission.id;
  await page.goto(`/missions/${mission.id}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('button', { name: es.missionDetail.importPoints.cta }).click();
  const dialog = page.getByRole('dialog', { name: es.missionDetail.importPoints.title });
  await dialog.getByLabel(es.missionDetail.importPoints.kindLabel).selectOption('waypoint');
  await dialog.getByLabel(es.missionDetail.importPoints.fileLabel).setInputFiles(GPX('ejemplo-importar.gpx'));
  await dialog.getByRole('button', { name: es.missionDetail.importPoints.submit }).click();
  await expect(page.getByText(es.missionDetail.importPoints.done.replace('{{count}}', '2'))).toBeVisible();
  const waypoints = page.getByRole('region', { name: es.missionDetail.points.groups.waypoint });
  await expect(waypoints).toContainText('Inicio ficticio');
  await expect(waypoints).toContainText('Final ficticio');
  await expect(waypoints.getByRole('listitem').first()).toContainText(/Altitud: [\d.,]+ m/);
  await expectNoHorizontalOverflow(page);
});

test('the administrator reads the library without write buttons and the rescuer has no access', async ({ roleContext }) => {
  const admin = await openSession(roleContext, ACCOUNTS.admin);
  await admin.goto('/routes');
  await expect(admin.getByRole('heading', { level: 1, name: R.title })).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true })).toBeVisible();
  await expect(admin.getByRole('link', { name: R.importCta })).toHaveCount(0);
  await expect(admin.getByRole('link', { name: R.drawCta })).toHaveCount(0);
  await admin.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true }).click();
  await expect(admin.getByRole('heading', { level: 1, name: 'Senda del Circo (ficticia)' })).toBeVisible();
  expect(await menuItemNames(admin, es.common.export)).toEqual([D.actions.exportGpx, D.actions.exportKml]);
  for (const name of [D.actions.validate, es.common.more]) await expect(admin.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(admin.getByRole('link', { name: D.actions.edit, exact: true })).toHaveCount(0);
  await admin.goto('/routes/import');
  await expect(admin.getByText(es.forbidden.title)).toBeVisible();

  const rescuer = await openSession(roleContext, ACCOUNTS.rescuer);
  await rescuer.goto('/routes');
  await expect(rescuer.getByText(es.forbidden.title)).toBeVisible();
  await expect(rescuer.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true })).toHaveCount(0);
});

test('another organization sees none of the routes (INV-01), through the API and through the web', async ({ roleContext }) => {
  const { ORG_B } = await import('./support/stack');
  const b = await openSession(roleContext, { email: ORG_B.adminEmail, password: ORG_B.password });
  // El administrador de B lee su biblioteca: vacía; las rutas de A no existen para él.
  await b.goto('/routes');
  await expect(b.getByRole('heading', { level: 1, name: R.title })).toBeVisible();
  await expect(b.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true })).toHaveCount(0);
  const own = await b.request.get('/api/v1/routes?pageSize=200');
  expect(((await own.json()) as { total: number }).total).toBe(0);
  const foreign = await b.request.get(`/api/v1/routes/${run.routeId}`);
  expect(foreign.status()).toBe(404);
  await b.goto(`/routes/${run.routeId}`);
  await expect(b.getByRole('alert')).toBeVisible();
});

test('the library works with the keyboard only and in French', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(es.account.languageFr).check();
  await page.getByLabel(fr.login.email).fill(ACCOUNTS.coordinatorFr.email);
  await page.getByLabel(fr.login.password).fill(ACCOUNTS.coordinatorFr.password);
  await page.getByLabel(fr.login.password).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1, name: fr.home.title })).toBeVisible();
  await page.goto('/routes');
  await expect(page.getByRole('heading', { level: 1, name: fr.routes.title })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // La búsqueda por nombre deja una sola tarjeta (la lista cambia con otras pruebas en marcha). Con Tab se llega a ella y con Intro
  // se abre su detalle, en francés.
  await page.getByLabel(fr.routes.searchLabel).fill('Senda del Circo');
  await expect(page.locator('.route-card')).toHaveCount(1);
  const link = page.getByRole('link', { name: 'Senda del Circo (ficticia)', exact: true });
  await tabTo(page, link, 140);
  await page.keyboard.press('Enter');
  // En el runner del CI (2 núcleos, WebGL por software) el móvil se queda sin pintar unos 20 s al pasar del listado con mapa al detalle con mapa
  // (trazas de los fallos de 6be9e58 y 7906d53: ni un fotograma ni una petición entre Intro y la petición del detalle; la API responde en <150 ms).
  // Es lentitud del navegador de la prueba, no del producto: aquí se espera más que los 15 s del resto de la prueba.
  const SLOW_NAVIGATION = { timeout: 45_000 };
  await expect(page).toHaveURL(/\/routes\/[0-9a-f-]{36}$/, SLOW_NAVIGATION);
  await expect(page.getByRole('heading', { level: 1, name: 'Senda del Circo (ficticia)' })).toBeVisible(SLOW_NAVIGATION);
  await expect(page.getByRole('heading', { level: 2, name: fr.routeDetail.versions.title })).toBeVisible(SLOW_NAVIGATION);
  await expect(page.getByRole('button', { name: fr.common.export, exact: true })).toBeVisible();
  // El perfil de elevación tiene su tabla equivalente, alcanzable con el teclado.
  const summary = page.getByText(fr.routeDetail.profile.showTable);
  await tabTo(page, summary, 140);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table', { name: fr.routeDetail.profile.tableCaption })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
