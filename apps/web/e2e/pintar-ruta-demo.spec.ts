// Demostración del cambio «pintar ruta y continuar a mano» (specs/issue-pintar-ruta/) contra la pila `compose.yml` + `infra/compose.e2e.yml`,
// en escritorio y en 375 px, con el motor REAL sobre la red INVENTADA. El camino exacto del coordinador:
//   1. Desde una misión, «Pintar ruta»: empieza en el origen, el interruptor activado añade puntos y desactivado no, «Terminar en el
//      objetivo», y al guardar la ruta queda en la misión.
//   2. Genera rutas desde la misión y, desde el «⋯» de una fila, «Continuar a mano»: corte con «Conservar los primeros km», un punto a mano,
//      «Terminar en el objetivo» → versión 2 en borrador con «Sin camino» en la composición; la versión 1 no cambia.
//   3. En francés y solo con teclado: el campo de km elige el corte y el interruptor se cambia con Espacio.
//   4. Con la misión cerrada, pintar desde ella no deja guardar (INV-11).
// Lo que deja: la misión «E2E …» cerrada con sus rutas (archivadas al final).
import type { Page } from '@playwright/test';
import { ACCOUNTS, fr } from './support/app';
import { archiveLeftoverE2eRoutes, closeLeftoverE2eMissions } from './support/stack';
import { clickMapCenter, es, expect, expectNoHorizontalOverflow, login, tabTo, test } from './support/demo';

const STAMP = Date.now().toString(36).slice(-6);
const R = es.missionRoutes;
const E = es.routeEditor;
const C = es.routeContinue;
const WEST = { lat: 42.63, lon: -0.07 };
const TARGET = { lat: 42.69, lon: -0.02 };
// Un punto a mano entre el corte y el objetivo, dentro del terreno inventado.
const HAND = { lat: 42.665, lon: -0.035 };

test.describe.configure({ mode: 'serial', timeout: 240_000 });

interface Row {
  id: string;
  routeId: string;
  name: string;
  pinned: { versionId: string };
}
interface Version {
  number: number;
  status: string;
  metrics: { distanceM: number; ascentM: number };
  roadMix: { roadType: string; distanceM: number }[];
}
const run = { mission: '', missionName: '', origin: '', generated: null as Row | null };
const nameOf = (info: { project: { name: string } }, label: string) => `E2E ${info.project.name} ${STAMP} ${label}`;
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key]));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function apiGet<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(`/api/v1${url}`);
  expect(response.status(), url).toBe(200);
  return (await response.json()) as T;
}
async function apiPost<T>(page: Page, url: string, body: unknown): Promise<T> {
  const me = await apiGet<{ csrfToken: string }>(page, '/auth/me');
  const response = await page.request.post(`/api/v1${url}`, { data: body, headers: { 'X-CSRF-Token': me.csrfToken } });
  expect(response.status(), `${url} ${await response.text()}`).toBeLessThan(300);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
const staffRows = async (page: Page) => (await apiGet<{ items: Row[] }>(page, `/missions/${run.mission}/routes`)).items;
const section = (page: Page) => page.getByRole('region', { name: R.title, exact: true });
const rowOf = (page: Page, name: string) => section(page).getByRole('row', { name: new RegExp(escape(name)) });
const count = (page: Page, n: number) => page.getByText(new RegExp(`^${escape(fill(E.verticesCount, { count: n }))} ·`));
/** Escribe las coordenadas del vértice `n` (1, 2…) en la lista: la alternativa de teclado al mapa. */
async function setVertex(page: Page, n: number, point: { lat: number; lon: number }) {
  for (const [label, value] of [
    [E.latLabel, point.lat],
    [E.lonLabel, point.lon],
  ] as const) {
    const field = page.getByLabel(fill(label, { n }), { exact: true });
    await field.fill(String(value));
    await field.press('Enter');
  }
}

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.afterAll(async ({}, info) => {
  await closeLeftoverE2eMissions(`E2E ${info.project.name} ${STAMP} %`);
  await archiveLeftoverE2eRoutes(`E2E ${info.project.name} ${STAMP} %`);
});

test('from a mission, «Paint route» starts at the origin, the toggle adds points only when on, and the route lands in the mission', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  run.missionName = nameOf(info, 'misión');
  run.origin = nameOf(info, 'Collado');
  run.mission = (await apiPost<{ id: string }>(page, '/missions', { name: run.missionName, target: { source: 'map', ...TARGET } })).id;
  await apiPost(page, `/missions/${run.mission}/points`, { kind: 'origin', ...WEST, name: run.origin });

  await page.goto(`/missions/${run.mission}`);
  await section(page).getByRole('button', { name: R.more }).click();
  await page.getByRole('menuitem', { name: E.paint }).click();
  await expect(page.getByRole('heading', { level: 1, name: fill(E.mission.title, { name: run.missionName }) })).toBeVisible();
  await expect(count(page, 1)).toBeVisible();
  await expect(page.getByLabel(new RegExp(`^${escape(E.nameLabel)}`))).toHaveValue(run.origin);

  const map = page.getByRole('region', { name: E.mapLabel });
  const paint = page.getByRole('button', { name: E.paint });
  await expect(paint).toHaveAttribute('aria-pressed', 'true');
  await clickMapCenter(map, 40, -40);
  await expect(count(page, 2)).toBeVisible();
  await setVertex(page, 2, HAND);
  await paint.click();
  await expect(paint).toHaveAttribute('aria-pressed', 'false');
  await clickMapCenter(map, -60, 60);
  await expect(count(page, 2)).toBeVisible();
  await page.getByRole('button', { name: E.mission.toTarget }).click();
  await expect(count(page, 3)).toBeVisible();
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);

  const drawn = nameOf(info, 'pintada');
  await page.getByLabel(new RegExp(`^${escape(E.nameLabel)}`)).fill(drawn);
  await page.getByRole('button', { name: E.save }).click();
  await expect(page.getByText(fill(E.mission.added, { name: drawn }))).toBeVisible();
  await expect(rowOf(page, drawn)).toBeVisible();
});

test('a generated route continued by hand from its row: version 2 is a draft with an off-trail stretch, and version 1 does not change', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/routes/generate?mission=${run.mission}`);
  await page.getByLabel(es.generate.nameLabel).fill(nameOf(info, 'Generada'));
  await page.getByRole('button', { name: es.generate.submit }).click();
  await expect(page.getByRole('region', { name: es.generate.compareTitle })).toBeVisible({ timeout: 60_000 });
  run.generated = (await staffRows(page)).find((row) => row.name === `${nameOf(info, 'Generada')} 1`)!;
  const generated = run.generated;
  const before = await apiGet<Version>(page, `/routes/${generated.routeId}/versions/${generated.pinned.versionId}`);

  await page.goto(`/missions/${run.mission}`);
  await rowOf(page, generated.name)
    .getByRole('button', { name: fill(R.actionsFor, { name: generated.name }) })
    .click();
  await page.getByRole('menuitem', { name: R.continue.action }).click();
  await expect(page.getByRole('heading', { level: 1, name: fill(C.title, { name: generated.name }) })).toBeVisible();

  const keptKm = Math.max(0.1, before.metrics.distanceM / 2000);
  const km = page.getByLabel(new RegExp(`^${escape(C.keepLabel.split(' (')[0]!)}`));
  await km.fill(keptKm.toFixed(2).replace('.', ','));
  await km.press('Enter');
  await expect(page.getByText(/^Se conservan /)).toBeVisible();
  await expect(page.getByRole('button', { name: E.paint })).toHaveAttribute('aria-pressed', 'true');

  await clickMapCenter(page.getByRole('region', { name: C.mapLabel }), -110, 90);
  await expect(page.getByText(fill(C.handCount, { count: 1 }))).toBeVisible();
  await setVertex(page, 1, HAND);
  await page.getByRole('button', { name: E.mission.toTarget }).click();
  await expect(page.getByText(fill(C.handCount, { count: 2 }))).toBeVisible();
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: E.saveVersion }).click();
  await expect(page.getByText(fill(C.savedDraft, { name: generated.name, number: 2 }))).toBeVisible();

  const detail = await apiGet<{ versions: (Version & { id: string })[] }>(page, `/routes/${generated.routeId}`);
  expect(detail.versions[0]).toMatchObject({ number: 2, status: 'draft' });
  const continued = await apiGet<Version>(page, `/routes/${generated.routeId}/versions/${detail.versions[0]!.id}`);
  expect(continued.roadMix.some((part) => part.roadType === 'offtrail' && part.distanceM > 0)).toBe(true);
  expect(continued.roadMix.some((part) => part.roadType !== 'offtrail' && part.distanceM > 0)).toBe(true);
  expect(await apiGet<Version>(page, `/routes/${generated.routeId}/versions/${generated.pinned.versionId}`)).toEqual(before);
  // La misión sigue fijando la versión 1 (D-P6): la nueva no se fija sola.
  expect((await staffRows(page)).find((row) => row.id === generated.id)!.pinned.versionId).toBe(generated.pinned.versionId);
});

test('in French and with the keyboard alone, the km field chooses the cut and Space switches the toggle', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.evaluate(() => localStorage.setItem('onway.locale', 'fr'));
  const F = fr.routeContinue;
  await page.goto(`/routes/${run.generated!.routeId}/continue?base=${run.generated!.pinned.versionId}`);
  await expect(page.getByRole('heading', { level: 1, name: fill(F.title, { name: run.generated!.name }) })).toBeVisible();
  const km = page.getByLabel(new RegExp(`^${escape(F.keepLabel.split(' (')[0]!)}`));
  await tabTo(page, km);
  await page.keyboard.type('0,2');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/conservés\.$/)).toBeVisible();
  const paint = page.getByRole('button', { name: fr.routeEditor.paint });
  await expect(paint).toHaveAttribute('aria-pressed', 'true');
  // El interruptor está encima del mapa, antes del campo: se vuelve hacia atrás con Mayús+Tab.
  for (let i = 0; i < 60 && !(await paint.evaluate((element) => element === document.activeElement)); i += 1) await page.keyboard.press('Shift+Tab');
  await expect(paint).toBeFocused();
  await page.keyboard.press('Space');
  await expect(paint).toHaveAttribute('aria-pressed', 'false');
});

test('with the mission closed, painting from it does not save (INV-11)', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await apiPost(page, `/missions/${run.mission}/activate`, { confirmWithoutValidatedRoute: true });
  await apiPost(page, `/missions/${run.mission}/close`, { attendance: [] });
  await page.goto(`/routes/draw?mission=${run.mission}`);
  await expect(page.getByText(fill(E.mission.closed, { name: run.missionName }))).toBeVisible();
  await expect(page.getByRole('button', { name: E.save })).toHaveCount(0);
  await expect(page.getByRole('button', { name: E.paint })).toHaveCount(0);
});
