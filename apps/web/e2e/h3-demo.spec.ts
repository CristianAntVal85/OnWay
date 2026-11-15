// Demostración de H3 (doc 07 §3, plan §6) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px: el motor de
// rutas REAL (GraphHopper) sobre la red INVENTADA de data/seed/network.osm y el terreno sintético (nada de datos reales ni de descargas).
// La red es una cuadrícula de senderos con una carretera al sur y una «frontera» inventada en la longitud −0,02. El coordinador abre una
// misión con un origen a cada lado de esa frontera, pulsa «Generar», ve el progreso y recibe varias alternativas por origen con distancia,
// desnivel y composición; las compara; dibuja una zona a evitar sobre la ruta principal y regenera (la ruta la esquiva); dibuja una ruta a
// mano y se pega a los caminos; con una misión sin origen el botón está desactivado; en francés y solo con teclado. Con el motor parado
// se prueba aparte (h3-engine-down.spec.ts): el resto de la aplicación sigue.
// Cada ejecución crea misiones y rutas «E2E …»: las misiones acaban cerradas y las rutas archivadas (RN-14); la zona que dibuja se borra.
import type { Page } from '@playwright/test';
import { ACCOUNTS, chooseMenuItem, fr } from './support/app';
import { archiveLeftoverE2eRoutes, closeLeftoverE2eMissions } from './support/stack';
import { clickMapCenter, es, expect, expectNoHorizontalOverflow, login, tabTo, test } from './support/demo';

const STAMP = Date.now().toString(36).slice(-6);
const G = es.generate;
const BORDER_LON = -0.02;
// Orígenes a cada lado de la frontera inventada y objetivo sobre ella, todos sobre la cuadrícula (una carretera al sur, senderos al norte).
const WEST = { lat: 42.63, lon: -0.07 };
const EAST = { lat: 42.63, lon: 0.04 };
const TARGET = { lat: 42.69, lon: -0.02 };

test.describe.configure({ mode: 'serial', timeout: 180_000 });

// Las rutas generadas quedan en la biblioteca como borradores: se cierran las misiones «E2E …» y se archivan sus rutas para que las
// demostraciones siguientes (H2 ve la biblioteca) encuentren la pila como estaba. Nada se borra (RN-14, auditoría de solo añadir).
test.afterAll(async () => {
  // Solo lo de esta ejecución (su sello): con 2 trabajadores, otra demostración puede tener a la vez misiones «E2E …» abiertas.
  await closeLeftoverE2eMissions(`E2E % ${STAMP} %`);
  await archiveLeftoverE2eRoutes(`E2E % ${STAMP} %`);
});

const run = { mission: '', west: '', east: '', mainRouteId: '', zoneSquare: null as null | { minLon: number; maxLon: number; minLat: number; maxLat: number }, handDrawnId: '' };
const nameOf = (info: { project: { name: string } }, label: string) => `E2E ${info.project.name} ${STAMP} ${label}`;

async function apiGet<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(`/api/v1${url}`);
  expect(response.status(), url).toBe(200);
  return (await response.json()) as T;
}
async function apiPost<T>(page: Page, url: string, body: unknown): Promise<T> {
  const me = await apiGet<{ csrfToken: string }>(page, '/auth/me');
  const response = await page.request.post(`/api/v1${url}`, { data: body, headers: { 'X-CSRF-Token': me.csrfToken } });
  expect(response.status(), `${url} ${await response.text()}`).toBeLessThan(300);
  return (await response.json()) as T;
}
interface Line {
  geometry: { coordinates: number[][] };
}
/** La geometría de la última versión de una ruta, leída del servidor. */
async function geometryOf(page: Page, routeId: string): Promise<number[][]> {
  const detail = await apiGet<{ versions: { id: string }[] }>(page, `/routes/${routeId}`);
  return (await apiGet<Line>(page, `/routes/${routeId}/versions/${detail.versions[0]!.id}`)).geometry.coordinates;
}
async function createMission(page: Page, name: string, origins: { lat: number; lon: number; name: string }[]): Promise<string> {
  const mission = await apiPost<{ id: string }>(page, '/missions', { name, target: { source: 'map', lat: TARGET.lat, lon: TARGET.lon } });
  for (const origin of origins) await apiPost(page, `/missions/${mission.id}/points`, { kind: 'origin', ...origin });
  return mission.id;
}
const table = (page: Page) => page.getByRole('region', { name: G.compareTitle }).getByRole('table');
const routeIdsOfResults = async (page: Page): Promise<string[]> => {
  const hrefs = await page
    .getByRole('region', { name: G.compareTitle })
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  return hrefs.map((href) => href.split('/').pop()!);
};

test('the coordinator generates alternatives from a mission with an origin on each side of the border', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  run.mission = await createMission(page, nameOf(info, 'dos vertientes'), [
    { ...WEST, name: 'Origen oeste (ficticio)' },
    { ...EAST, name: 'Origen este (ficticio)' },
  ]);
  await page.goto(`/missions/${run.mission}`);
  // La misión ofrece generar desde ella (hay origen), y desde la biblioteca también.
  await chooseMenuItem(page, es.missionRoutes.more, G.cta);
  await expect(page).toHaveURL(new RegExp(`/routes/generate\\?mission=${run.mission}`));
  await expect(page.getByRole('heading', { level: 1, name: /Desde la misión/ })).toBeVisible();
  await expect(page.getByText(G.missionTarget)).toBeVisible();
  const origin = page.getByRole('combobox', { name: G.originLabel });
  await expect(origin.locator('option')).toHaveCount(2);

  // Primer origen (el oeste): varias alternativas, con progreso.
  await page.getByLabel(G.nameLabel).fill(nameOf(info, 'oeste'));
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByRole('region', { name: G.compareTitle })).toBeVisible({ timeout: 60_000 });
  // La red inventada ofrece al menos dos alternativas por par (plan §6); el motor pone el tope, no el test.
  const west = await routeIdsOfResults(page);
  expect(west.length).toBeGreaterThanOrEqual(2);
  expect(west.length).toBeLessThanOrEqual(3);
  await expect(table(page).getByRole('row')).toHaveCount(west.length + 1); // cabecera y alternativas
  // Cada una con distancia, subida, bajada y composición (el servidor la midió: la barra dice qué porcentaje es sendero).
  await expect(table(page).getByRole('row').nth(1)).toContainText(/\d,\d km/);
  await expect(
    table(page)
      .getByRole('img', { name: /Tipo de vía/ })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(G.resultsHelp)).toBeVisible();
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);

  // Alternativas distintas: no todas la misma línea.
  const lines = await Promise.all(west.map((id) => geometryOf(page, id)));
  expect(new Set(lines.map((line) => JSON.stringify(line))).size).toBeGreaterThan(1);
  run.mainRouteId = west[0]!;

  // Segundo origen (el este): otras, y todas quedan en la misión con su versión 1.
  await page.getByRole('button', { name: G.again }).click();
  await page.getByRole('combobox', { name: G.originLabel }).selectOption({ label: 'Origen este (ficticio)' });
  await page.getByLabel(G.nameLabel).fill(nameOf(info, 'este'));
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByRole('region', { name: G.compareTitle })).toBeVisible({ timeout: 60_000 });
  const east = await routeIdsOfResults(page);
  expect(east.length).toBeGreaterThanOrEqual(2);
  expect(east.length).toBeLessThanOrEqual(3);
  const mission = await apiGet<{ routes: { total: number } }>(page, `/missions/${run.mission}`);
  expect(mission.routes.total).toBe(west.length + east.length);

  // Cada alternativa es un borrador de la biblioteca, versión 1.
  const detail = await apiGet<{ versions: { number: number; status: string; provenance: string }[] }>(page, `/routes/${east[0]}`);
  expect(detail.versions).toMatchObject([{ number: 1, status: 'draft', provenance: 'generated' }]);
});

test('a route from one side of the border to the other crosses it (RF-304)', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/routes/generate');
  await expect(page.getByRole('heading', { level: 1, name: G.title })).toBeVisible();
  const methods = page.getByRole('radio', { name: es.point.byCoordinates });
  const coordinates = page.getByRole('textbox', { name: es.point.coordinates, exact: true });
  await methods.nth(0).check();
  await coordinates.nth(0).fill(`${WEST.lat}, ${WEST.lon}`);
  await coordinates.nth(0).press('Enter');
  await methods.nth(1).check();
  await coordinates.nth(1).fill(`${EAST.lat}, ${EAST.lon}`);
  await coordinates.nth(1).press('Enter');
  await page.getByLabel(G.nameLabel).fill(nameOf(info, 'cruce'));
  await page.getByRole('combobox', { name: G.alternativesLabel }).selectOption('2');
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByRole('region', { name: G.compareTitle })).toBeVisible({ timeout: 60_000 });
  const ids = await routeIdsOfResults(page);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  const main = await geometryOf(page, ids[0]!);
  const lons = main.map((position) => position[0]!);
  expect(Math.min(...lons)).toBeLessThan(BORDER_LON);
  expect(Math.max(...lons)).toBeGreaterThan(BORDER_LON);
  // De ahí sale la zona de la prueba siguiente: un cuadrado de unos 300 m sobre el punto medio de esta ruta.
  const middle = main[Math.floor(main.length / 2)]!;
  run.zoneSquare = { minLon: middle[0]! - 0.002, maxLon: middle[0]! + 0.002, minLat: middle[1]! - 0.0014, maxLat: middle[1]! + 0.0014 };
});

test('a zone to avoid drawn over the main route is avoided when generating again', async ({ page }, info) => {
  expect(run.zoneSquare, 'la prueba anterior fija la zona').not.toBeNull();
  const square = run.zoneSquare!;
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/routes/generate');
  const methods = page.getByRole('radio', { name: es.point.byCoordinates });
  const coordinates = page.getByRole('textbox', { name: es.point.coordinates, exact: true });
  await methods.nth(0).check();
  await coordinates.nth(0).fill(`${WEST.lat}, ${WEST.lon}`);
  await coordinates.nth(0).press('Enter');
  await methods.nth(1).check();
  await coordinates.nth(1).fill(`${EAST.lat}, ${EAST.lon}`);
  await coordinates.nth(1).press('Enter');

  // Dibujar la zona: tres toques en el mapa y las coordenadas escritas en la tabla (la alternativa de teclado).
  await page.getByRole('button', { name: G.drawZone }).click();
  const zoneMap = page.getByRole('region', { name: G.zoneMapLabel });
  for (const [dx, dy] of [
    [-60, -40],
    [60, -40],
    [0, 50],
  ] as const)
    await clickMapCenter(zoneMap, dx, dy);
  const corners = [
    [square.minLat, square.minLon],
    [square.minLat, square.maxLon],
    [square.maxLat, square.maxLon],
  ];
  for (const [index, [lat, lon]] of corners.entries()) {
    const latField = page.getByLabel(es.routeEditor.latLabel.replace('{{n}}', String(index + 1)), { exact: true });
    const lonField = page.getByLabel(es.routeEditor.lonLabel.replace('{{n}}', String(index + 1)), { exact: true });
    await latField.fill(String(lat));
    await latField.press('Enter');
    await lonField.fill(String(lon));
    await lonField.press('Enter');
  }
  await page.getByLabel(G.zoneReasonLabel).fill(nameOf(info, 'zona'));
  await page.getByRole('button', { name: G.saveZone }).click();
  await expect(page.getByText(G.zoneSaved)).toBeVisible();
  const zoneItem = page.getByRole('checkbox', { name: new RegExp(nameOf(info, 'zona')) });
  await expect(zoneItem).toBeChecked();

  await page.getByLabel(G.nameLabel).fill(nameOf(info, 'esquiva'));
  await page.getByRole('combobox', { name: G.alternativesLabel }).selectOption('1');
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByRole('region', { name: G.compareTitle })).toBeVisible({ timeout: 60_000 });
  const [routeId] = await routeIdsOfResults(page);
  const detour = await geometryOf(page, routeId!);
  const inside = detour.filter(([lon, lat]) => lon! >= square.minLon && lon! <= square.maxLon && lat! >= square.minLat && lat! <= square.maxLat);
  expect(inside, 'ningún vértice de la nueva ruta entra en la zona').toHaveLength(0);
  // La zona se puede borrar (se borra: no hay historial que proteger), y la pila queda como estaba.
  await page.getByRole('button', { name: G.again }).click();
  await page.getByRole('button', { name: G.zoneDelete.replace('{{name}}', nameOf(info, 'zona')) }).click();
  await expect(page.getByText(G.zoneDeleted)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: new RegExp(nameOf(info, 'zona')) })).toHaveCount(0);
});

test('a hand-drawn route sticks to the paths and keeps its composition', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/routes/draw');
  const E = es.routeEditor;
  await expect(page.getByRole('heading', { level: 1, name: E.drawTitle })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: E.snapLabel })).toBeChecked();
  const calculate = page.getByRole('button', { name: E.snapPreview });
  await expect(calculate).toBeDisabled();
  const map = page.getByRole('region', { name: E.mapLabel });
  await clickMapCenter(map, -50, 0);
  await clickMapCenter(map, 50, 0);
  // Las coordenadas se escriben en la lista: puntos a unos 30 m de la fila de senderos de la latitud 42,65.
  const points = [
    [42.6503, -0.08],
    [42.6503, -0.01],
  ];
  for (const [index, [lat, lon]] of points.entries()) {
    const latField = page.getByLabel(E.latLabel.replace('{{n}}', String(index + 1)), { exact: true });
    const lonField = page.getByLabel(E.lonLabel.replace('{{n}}', String(index + 1)), { exact: true });
    await latField.fill(String(lat));
    await latField.press('Enter');
    await lonField.fill(String(lon));
    await lonField.press('Enter');
  }
  await calculate.click();
  await expect(page.getByText(/Ruta por los caminos: \d,\d km/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('img', { name: /Tipo de vía: Sendero/ })).toBeVisible();

  const name = nameOf(info, 'a mano');
  await page.getByLabel(E.nameLabel).fill(name);
  await page.getByRole('button', { name: E.save }).click();
  await expect(page).toHaveURL(/\/routes\/[0-9a-f-]{36}$/);
  run.handDrawnId = page.url().split('/').pop()!;
  // Guardada con su composición real (no «sin clasificar»), borrador y dibujada a mano.
  const detail = await apiGet<{ versions: { provenance: string; roadMix: { roadType: string }[] }[] }>(page, `/routes/${run.handDrawnId}`);
  expect(detail.versions[0]!.provenance).toBe('drawn');
  expect(detail.versions[0]!.roadMix.map((part) => part.roadType)).not.toContain('unknown');
  await expect(page.getByRole('img', { name: /Tipo de vía: Sendero/ })).toBeVisible();
  const line = await geometryOf(page, run.handDrawnId);
  expect(line.length).toBeGreaterThan(points.length); // el servidor la unió siguiendo los caminos
  // Todos sus vértices están sobre la cuadrícula de senderos de la latitud 42,65 (no en la línea recta a 30 m).
  expect(line.every(([, lat]) => Math.abs(lat! - 42.65) < 0.0006 || Math.abs(((lat! - 42.62) / 0.01) % 1) < 0.06 || Math.abs((((lat! - 42.62) / 0.01) % 1) - 1) < 0.06)).toBe(true);
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);
});

test('without an origin the mission cannot generate, and says why', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  const missionId = await createMission(page, nameOf(info, 'sin origen'), []);
  await page.goto(`/missions/${missionId}`);
  // RN-08: sin origen, «Generar rutas» está en el menú de la sección pero desactivada; la lista de preparación dice qué falta.
  await page.getByRole('button', { name: es.missionRoutes.more, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: G.cta, exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  // Y si se llega a la página de generar con esa misión, tampoco deja.
  await page.goto(`/routes/generate?mission=${missionId}`);
  await expect(page.getByText(new RegExp(G.noOrigin)).first()).toBeVisible();
  await expect(page.getByRole('button', { name: G.submit })).toBeDisabled();
});

test('the French coordinator generates with the keyboard alone', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinatorFr);
  const missionId = await createMission(page, nameOf(info, 'clavier'), [{ ...WEST, name: 'Origine ouest (fictive)' }]);
  await page.goto(`/routes/generate?mission=${missionId}`);
  const F = fr.generate;
  await expect(page.getByRole('heading', { level: 1, name: /Depuis la mission/ })).toBeVisible();
  await page.getByLabel(F.nameLabel).fill(nameOf(info, 'clavier'));
  await tabTo(page, page.getByRole('button', { name: F.submit }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: F.compareTitle })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: F.resultsTitle })).toBeVisible();
  await expect(page.getByText(F.resultsHelp)).toBeVisible();
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);
});
