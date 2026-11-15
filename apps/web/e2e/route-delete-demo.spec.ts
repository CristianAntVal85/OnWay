// Demostración de la issue #17 (eliminar rutas) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// El protocolo de borrado, de punta a punta: en la lista de activas y en el detalle NO hay botón de eliminar; se archivan tres rutas propias; en la lista de
// archivadas (`?status=archived`) se seleccionan dos, el diálogo dice cuántas son y que no se puede deshacer (cancelar no hace nada) y al confirmar
// desaparecen de la lista y de la API; una ruta archivada que sigue en una misión cerrada no se elimina y el informe lo explica. En francés y solo con teclado.
// Las rutas se crean y se eliminan de verdad (no dejan residuo); solo queda la misión «E2E …» cerrada con su ruta archivada, que es lo que la pila ya acumula.
import type { Page } from '@playwright/test';
import { ACCOUNTS, fr, menuItemNames } from './support/app';
import { archiveLeftoverE2eRoutes, closeLeftoverE2eMissions } from './support/stack';
import { es, expect, expectNoHorizontalOverflow, login, tabTo, test } from './support/demo';

const STAMP = Date.now().toString(36).slice(-6);
const R = es.routes;
const D = es.routeDetail;
const TARGET = { lat: 42.69, lon: -0.02 };

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const run = { a: '', b: '', c: '', kept: '', mission: '', missionName: '', e: '' };
const nameOf = (info: { project: { name: string } }, label: string) => `E2E ${info.project.name} ${STAMP} ${label}`;
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key]));
const line = (shift: number) => ({
  type: 'LineString',
  coordinates: Array.from({ length: 6 }, (_, i) => [TARGET.lon + shift + i * 0.0012, TARGET.lat + shift + i * 0.0009]),
});

async function apiGet<T>(page: Page, url: string, expected = 200): Promise<T | null> {
  const response = await page.request.get(`/api/v1${url}`);
  expect(response.status(), url).toBe(expected);
  return expected === 200 ? ((await response.json()) as T) : null;
}
async function apiPost<T>(page: Page, url: string, body: unknown, expected = 201): Promise<T> {
  const me = (await apiGet<{ csrfToken: string }>(page, '/auth/me'))!;
  const response = await page.request.post(`/api/v1${url}`, { data: body, headers: { 'X-CSRF-Token': me.csrfToken } });
  expect(response.status(), `${url} ${await response.text()}`).toBe(expected);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
const createRoute = async (page: Page, name: string, shift: number) =>
  (await apiPost<{ routeId: string; versionId: string }>(page, '/routes', { source: 'drawn', name, geometry: line(shift) })).routeId;
const listUrl = (info: { project: { name: string } }, status: 'active' | 'archived') => `/routes?status=${status}&q=${encodeURIComponent(`E2E ${info.project.name} ${STAMP}`)}`;
const card = (page: Page, text: string) => page.locator('.route-card', { hasText: text });
const pick = (page: Page, name: string, labels: typeof R) => page.getByRole('checkbox', { name: fill(labels.card.select, { name }) });

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.beforeAll(async ({}, info) => {
  await closeLeftoverE2eMissions(`E2E ${info.project.name} ${STAMP} %`);
  await archiveLeftoverE2eRoutes(`E2E ${info.project.name} ${STAMP} %`);
});

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.afterAll(async ({}, info) => {
  await closeLeftoverE2eMissions(`E2E ${info.project.name} ${STAMP} %`);
  await archiveLeftoverE2eRoutes(`E2E ${info.project.name} ${STAMP} %`);
});

test('there is no delete button in the active list or in the detail of a route', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  run.a = await createRoute(page, nameOf(info, 'borrar A'), 0);
  run.b = await createRoute(page, nameOf(info, 'borrar B'), 0.01);
  run.c = await createRoute(page, nameOf(info, 'quedarse C'), 0.02);
  run.kept = await createRoute(page, nameOf(info, 'misión D'), 0.03);

  await page.goto(listUrl(info, 'active'));
  await expect(card(page, nameOf(info, 'borrar A'))).toBeVisible();
  await pick(page, nameOf(info, 'borrar A'), R).check();
  await expect(page.getByRole('button', { name: R.selection.archive })).toBeVisible();
  await expect(page.getByRole('button', { name: R.selection.delete })).toHaveCount(0);
  await expect(page.locator('.btn-eliminar-ruta')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto(`/routes/${run.a}`);
  expect(await menuItemNames(page, es.common.more)).toContain(D.actions.archive);
  await expect(page.getByRole('button', { name: /eliminar/i })).toHaveCount(0);
  await expect(page.locator('.btn-eliminar-ruta')).toHaveCount(0);
});

test('archive three routes, then delete two from the archived list: cancelling changes nothing, confirming removes them for good', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  const [nameA, nameB, nameC] = [nameOf(info, 'borrar A'), nameOf(info, 'borrar B'), nameOf(info, 'quedarse C')];

  // Paso 1: archivar (la lista de activas no sabe eliminar).
  await page.goto(listUrl(info, 'active'));
  for (const name of [nameA, nameB, nameC]) await pick(page, name, R).check();
  await page.getByRole('button', { name: R.selection.archive }).click();
  await page
    .getByRole('dialog', { name: R.archive.title })
    .getByRole('button', { name: fill(R.archive.confirm, { count: 3 }) })
    .click();
  await expect(page.getByText(fill(R.archive.done, { count: 3 }))).toBeVisible();

  // Paso 2: en la lista de archivadas aparece «Eliminar seleccionadas», y solo con selección.
  await page.goto(listUrl(info, 'archived'));
  await expect(card(page, nameA)).toBeVisible();
  await expect(page.getByRole('button', { name: R.selection.delete })).toHaveCount(0);
  await pick(page, nameA, R).check();
  await pick(page, nameB, R).check();
  await expect(page.getByRole('button', { name: R.selection.archive })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Cancelar no cambia nada.
  await page.getByRole('button', { name: R.selection.delete }).click();
  const dialog = page.getByRole('dialog', { name: R.delete.title });
  await expect(dialog).toContainText(fill(R.delete.description, { count: 2 }));
  await expect(dialog).toContainText('no se puede deshacer');
  await expect(dialog.getByRole('listitem')).toHaveText([nameA, nameB]);
  await expect(dialog.getByRole('button', { name: R.delete.cancel })).toBeFocused();
  await dialog.getByRole('button', { name: R.delete.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await apiGet(page, `/routes/${run.a}`);
  await apiGet(page, `/routes/${run.b}`);
  await expect(page.getByText(fill(R.selection.count, { count: 2 }))).toBeVisible();

  // Confirmar las elimina de la lista y de la API; la tercera sigue.
  await page.getByRole('button', { name: R.selection.delete }).click();
  await page
    .getByRole('dialog', { name: R.delete.title })
    .getByRole('button', { name: fill(R.delete.confirm, { count: 2 }) })
    .click();
  await expect(page.getByText(fill(R.delete.done, { count: 2 }))).toBeVisible();
  await expect(card(page, nameA)).toHaveCount(0);
  await expect(card(page, nameB)).toHaveCount(0);
  await expect(card(page, nameC)).toBeVisible();
  await apiGet(page, `/routes/${run.a}`, 404);
  await apiGet(page, `/routes/${run.b}`, 404);
  await apiGet(page, `/routes/${run.c}`);
  await page.reload();
  await expect(card(page, nameA)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('an archived route that a closed mission keeps is not deleted, and the report says which mission', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  run.missionName = nameOf(info, 'misión cerrada');
  const mission = await apiPost<{ id: string }>(page, '/missions', { name: run.missionName, target: { source: 'map', lat: TARGET.lat, lon: TARGET.lon } });
  run.mission = mission.id;
  await apiPost(page, `/missions/${run.mission}/points`, { kind: 'origin', lat: TARGET.lat - 0.01, lon: TARGET.lon - 0.01, name: 'Origen E2E' });
  await apiPost(page, `/missions/${run.mission}/routes`, { items: [{ routeId: run.kept }] });
  await apiPost(page, `/missions/${run.mission}/activate`, { confirmWithoutValidatedRoute: true }, 200);
  await apiPost(page, `/missions/${run.mission}/close`, { attendance: [] }, 200);
  await apiPost(page, `/routes/${run.kept}/archive`, {}, 200);

  const keptName = nameOf(info, 'misión D');
  await page.goto(listUrl(info, 'archived'));
  await pick(page, keptName, R).check();
  await page.getByRole('button', { name: R.selection.delete }).click();
  await page.getByRole('dialog', { name: R.delete.title }).getByRole('button', { name: R.delete.confirmOne }).click();
  await expect(page.getByText(fill(R.delete.failed, { names: keptName }))).toBeVisible();
  await expect(page.getByText(fill(R.delete.inUse, { name: keptName, missions: run.missionName }))).toBeVisible();
  await expect(page.getByText(fill(R.delete.done, { count: 1 }))).toHaveCount(0);
  await expect(card(page, keptName)).toBeVisible();
  await apiGet(page, `/routes/${run.kept}`);
});

test('in French and with the keyboard alone, the archived list deletes a route', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.evaluate(() => localStorage.setItem('onway.locale', 'fr'));
  const F = fr.routes;
  const name = nameOf(info, 'français E');
  run.e = await createRoute(page, name, 0.04);
  await apiPost(page, `/routes/${run.e}/archive`, {}, 200);

  await page.goto(listUrl(info, 'archived'));
  const box = pick(page, name, F);
  await expect(box).toBeVisible();
  await tabTo(page, box);
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  const open = page.getByRole('button', { name: F.selection.delete });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: F.delete.title });
  await expect(dialog).toContainText(fill(F.delete.descriptionOne, {}));
  await expect(dialog.getByRole('button', { name: F.delete.cancel })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: F.delete.confirmOne })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText(fill(F.delete.done, { count: 1 }))).toBeVisible();
  await apiGet(page, `/routes/${run.e}`, 404);
});
