// Demostración del cambio «nombre de las rutas y desvincular» (specs/issue-rutas-nombre-y-desvincular/) contra la pila `compose.yml` +
// `infra/compose.e2e.yml`, en escritorio y en 375 px, con el motor REAL sobre la red INVENTADA. El camino exacto del coordinador:
//   1. Genera rutas desde una misión: el nombre viene propuesto con el del origen y, vacío, no deja generar; salen «<origen> 1», «<origen> 2».
//   2. Renombra una desde el «⋯» de su fila en la misión y otra desde «Más ⋯» de su detalle.
//   3. Una ruta que no le gusta: desde «Usada en» de su detalle la quita de la misión, la archiva y la elimina desde la lista de archivadas.
//   4. Con la misión cerrada no se puede quitar nada, ni desde la fila ni desde «Usada en».
//   5. En francés y solo con teclado, «Retirer de la mission» pide confirmación con el foco en la opción segura.
// Lo que deja: la misión «E2E …» cerrada con sus rutas (archivadas al final); la ruta eliminada no deja nada.
import type { Page } from '@playwright/test';
import { ACCOUNTS, chooseMenuItem, fr, menuItemNames } from './support/app';
import { archiveLeftoverE2eRoutes, closeLeftoverE2eMissions } from './support/stack';
import { es, expect, expectNoHorizontalOverflow, login, tabTo, test } from './support/demo';

const STAMP = Date.now().toString(36).slice(-6);
const R = es.missionRoutes;
const G = es.generate;
const D = es.routeDetail;
const L = es.routes;
const WEST = { lat: 42.63, lon: -0.07 };
const TARGET = { lat: 42.69, lon: -0.02 };

test.describe.configure({ mode: 'serial', timeout: 240_000 });

interface Row {
  id: string;
  routeId: string;
  name: string;
}
const run = { mission: '', missionName: '', origin: '', first: null as Row | null, second: null as Row | null, french: '' };
const nameOf = (info: { project: { name: string } }, label: string) => `E2E ${info.project.name} ${STAMP} ${label}`;
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key]));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function apiGet<T>(page: Page, url: string, expected = 200): Promise<T> {
  const response = await page.request.get(`/api/v1${url}`);
  expect(response.status(), url).toBe(expected);
  return (expected === 200 ? await response.json() : null) as T;
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

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.afterAll(async ({}, info) => {
  await closeLeftoverE2eMissions(`E2E ${info.project.name} ${STAMP} %`);
  await archiveLeftoverE2eRoutes(`E2E ${info.project.name} ${STAMP} %`);
});

test('from a mission, the name is proposed from the origin, an empty one does not generate, and the alternatives are «<origin> n»', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  run.missionName = nameOf(info, 'misión');
  run.origin = nameOf(info, 'Collado');
  run.mission = (await apiPost<{ id: string }>(page, '/missions', { name: run.missionName, target: { source: 'map', ...TARGET } })).id;
  await apiPost(page, `/missions/${run.mission}/points`, { kind: 'origin', ...WEST, name: run.origin });

  await page.goto(`/missions/${run.mission}`);
  await chooseMenuItem(page, R.more, G.cta);
  const name = page.getByLabel(G.nameLabel);
  await expect(name).toHaveValue(run.origin);
  await name.fill('');
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByText(G.nameRequired)).toBeVisible();
  await expect(page.getByRole('region', { name: G.compareTitle })).toHaveCount(0);
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);

  await name.fill(run.origin);
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByRole('region', { name: G.compareTitle })).toBeVisible({ timeout: 60_000 });
  const rows = await staffRows(page);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows.map((row) => row.name).sort()).toEqual(rows.map((_, index) => `${run.origin} ${index + 1}`));
  run.first = rows.find((row) => row.name === `${run.origin} 1`)!;
  run.second = rows.find((row) => row.name === `${run.origin} 2`)!;
});

test('renames one route from its row in the mission and another from its detail', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/missions/${run.mission}`);
  const fromRow = nameOf(info, 'por la cresta');
  const menu = fill(R.actionsFor, { name: run.first!.name });
  expect(await menuItemNames(rowOf(page, run.first!.name), menu)).toEqual(expect.arrayContaining([R.rename.action, R.remove.action]));
  await chooseMenuItem(rowOf(page, run.first!.name), menu, R.rename.action);
  const dialog = page.getByRole('dialog', { name: D.rename.title });
  await expect(dialog.getByLabel(D.rename.nameLabel)).toBeFocused();
  await dialog.getByLabel(D.rename.nameLabel).fill(fromRow);
  await dialog.getByRole('button', { name: D.rename.confirm }).click();
  await expect(section(page).getByText(fill(D.rename.done, { name: fromRow }))).toBeVisible();
  await expect(rowOf(page, fromRow)).toBeVisible();
  run.first = { ...run.first!, name: fromRow };

  const fromDetail = nameOf(info, 'por el valle');
  await page.goto(`/routes/${run.second!.routeId}`);
  await chooseMenuItem(page, es.common.more, D.actions.rename);
  await page.getByRole('dialog', { name: D.rename.title }).getByLabel(D.rename.nameLabel).fill(fromDetail);
  await page.getByRole('dialog', { name: D.rename.title }).getByRole('button', { name: D.rename.confirm }).click();
  await expect(page.getByRole('heading', { level: 1, name: fromDetail })).toBeVisible();
  run.second = { ...run.second!, name: fromDetail };
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);
});

test('a route that is not wanted: removed from the mission in «Used in», archived and deleted from the archived list', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/routes/${run.second!.routeId}`);
  await page.getByRole('button', { name: fill(D.relations.removeFor, { mission: run.missionName }) }).click();
  const confirm = page.getByRole('group', { name: fill(D.relations.removeConfirm, { mission: run.missionName }) });
  await expect(confirm.getByRole('button', { name: D.relations.removeNo })).toBeFocused();
  await confirm.getByRole('button', { name: D.relations.removeYes }).click();
  await expect(page.getByText(fill(D.relations.removeDone, { mission: run.missionName }))).toBeAttached();
  await expect(page.getByText(D.relations.notUsed)).toBeVisible();
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);

  await chooseMenuItem(page, es.common.more, D.actions.archive);
  await page.getByRole('dialog', { name: D.archive.title }).getByRole('button', { name: D.archive.confirm }).click();
  await expect(page.getByText(D.archivedNotice)).toBeVisible();

  await page.goto(`/routes?status=archived&q=${encodeURIComponent(run.second!.name)}`);
  await page.getByRole('checkbox', { name: fill(L.card.select, { name: run.second!.name }) }).check();
  await page.getByRole('button', { name: L.selection.delete }).click();
  await page.getByRole('dialog', { name: L.delete.title }).getByRole('button', { name: L.delete.confirmOne }).click();
  await expect(page.getByText(fill(L.delete.done, { count: 1 }))).toBeVisible();
  await apiGet(page, `/routes/${run.second!.routeId}`, 404);
  expect((await staffRows(page)).map((row) => row.routeId)).not.toContain(run.second!.routeId);
});

test('in French and with the keyboard alone, «Retirer de la mission» asks first, with the focus on the safe option', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.evaluate(() => localStorage.setItem('onway.locale', 'fr'));
  const F = fr.routeDetail.relations;
  await page.goto(`/routes/${run.first!.routeId}`);
  const remove = page.getByRole('button', { name: fill(F.removeFor, { mission: run.missionName }) });
  await expect(remove).toBeVisible();
  await tabTo(page, remove);
  await page.keyboard.press('Enter');
  const no = page.getByRole('button', { name: F.removeNo });
  await expect(no).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(remove).toBeVisible();
  expect((await staffRows(page)).map((row) => row.routeId)).toContain(run.first!.routeId);
});

test('with the mission closed nothing can be removed, neither from the row nor from «Used in»', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await apiPost(page, `/missions/${run.mission}/activate`, { confirmWithoutValidatedRoute: true });
  await apiPost(page, `/missions/${run.mission}/close`, { attendance: [] });

  await page.goto(`/missions/${run.mission}`);
  await expect(rowOf(page, run.first!.name)).toBeVisible();
  await expect(rowOf(page, run.first!.name).getByRole('button', { name: fill(R.actionsFor, { name: run.first!.name }) })).toHaveCount(0);

  await page.goto(`/routes/${run.first!.routeId}`);
  await expect(page.getByRole('link', { name: run.missionName })).toBeVisible();
  await expect(page.getByText(new RegExp(`${escape(D.relations.readOnly)}$`))).toBeVisible();
  await expect(page.getByRole('button', { name: fill(D.relations.removeFor, { mission: run.missionName }) })).toHaveCount(0);
});
