// Demostración de H4, la del MVP (doc 07 §3, plan §6) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px, con el motor de
// rutas REAL sobre la red INVENTADA y el terreno sintético (nada de datos reales ni de descargas). La historia completa de dos roles:
//   1. El coordinador abre una misión con un origen, genera rutas, ve que activar sin ninguna validada pide confirmar, añade una ruta de la biblioteca
//      (la repetida no se deja elegir), valida dos desde la propia misión, las compara (tabla y perfiles), marca una como no disponible y activa.
//   2. El rescatista, solo con teclado y en francés, ve únicamente las validadas y fijadas (la no disponible, señalada y sin descarga), comparte la
//      ubicación del objetivo y descarga el GPX de una ruta y de todas (sin borradores, sin la no disponible, sin autor).
//   3. El coordinador edita la ruta y valida su versión 2: la misión sigue con la fijada y avisa; el rescatista sigue viendo la fijada; el coordinador
//      actualiza y entonces el rescatista ve la nueva.
//   4. Una ruta en una misión abierta no se archiva; otra organización recibe 404; una misión en planificación no existe para el rescatista; al
//      cerrar la misión el rescatista lee las rutas pero ya no las descarga.
// Cada ejecución crea misiones y rutas «E2E …» con su sello: las misiones acaban cerradas y las rutas archivadas (RN-14).
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ACCOUNTS, chooseMenuItem, fr } from './support/app';
import { ORG_B, archiveLeftoverE2eRoutes, closeLeftoverE2eMissions } from './support/stack';
import { es, expect, expectNoHorizontalOverflow, login, openSession, tabTo, test } from './support/demo';

const STAMP = Date.now().toString(36).slice(-6);
const R = es.missionRoutes;
const A = R.add;
const G = es.generate;
const L = es.missionDetail.lifecycle;
const D = es.routeDetail;
const WEST = { lat: 42.63, lon: -0.07 };
const TARGET = { lat: 42.69, lon: -0.02 };
const TARGET_TEXT = '42.69000, -0.02000';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

// Solo lo de esta ejecución y de este formato (su sello y su proyecto): con 2 trabajadores, otra demostración puede tener misiones «E2E …» abiertas.
// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.afterAll(async ({}, info) => {
  await closeLeftoverE2eMissions(`E2E ${info.project.name} ${STAMP} %`);
  await archiveLeftoverE2eRoutes(`E2E ${info.project.name} ${STAMP} %`);
});

interface Row {
  id: string;
  routeId: string;
  name: string;
  status: string;
  pinned: { versionId: string; number: number; status: string };
  newerValidatedVersion: { number: number } | null;
}
const run = { mission: '', planning: '', first: null as Row | null, second: null as Row | null, libraryRow: '' };
const nameOf = (info: { project: { name: string } }, label: string) => `E2E ${info.project.name} ${STAMP} ${label}`;
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key]));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function apiGet<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(`/api/v1${url}`);
  expect(response.status(), url).toBe(200);
  return (await response.json()) as T;
}
async function apiSend<T>(page: Page, method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, expected?: number): Promise<{ status: number; body: T }> {
  const me = await apiGet<{ csrfToken: string }>(page, '/auth/me');
  const response = await page.request.fetch(`/api/v1${url}`, { method, data: body, headers: { 'X-CSRF-Token': me.csrfToken } });
  if (expected !== undefined) expect(response.status(), `${method} ${url} ${await response.text()}`).toBe(expected);
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as T };
}
const apiPost = async <T>(page: Page, url: string, body: unknown): Promise<T> => {
  const { status, body: parsed } = await apiSend<T>(page, 'POST', url, body);
  expect(status, url).toBeLessThan(300);
  return parsed;
};
async function createMission(page: Page, name: string, origins: { lat: number; lon: number; name: string }[]): Promise<string> {
  const mission = await apiPost<{ id: string }>(page, '/missions', { name, target: { source: 'map', lat: TARGET.lat, lon: TARGET.lon } });
  for (const origin of origins) await apiPost(page, `/missions/${mission.id}/points`, { kind: 'origin', ...origin });
  return mission.id;
}
const staffRows = async (page: Page, mission = run.mission) => (await apiGet<{ items: Row[] }>(page, `/missions/${mission}/routes`)).items;
const section = (page: Page, name = R.title) => page.getByRole('region', { name, exact: true });
const rowOf = (page: Page, name: string) => section(page).getByRole('row', { name: new RegExp(escape(name)) });

async function validateFromRow(page: Page, row: Row): Promise<void> {
  await rowOf(page, row.name)
    .getByRole('button', { name: fill(R.validate.actionFor, { name: row.name }) })
    .click();
  const dialog = page.getByRole('dialog', { name: fill(D.validate.title, { number: 1 }) });
  await expect(dialog.getByText(D.validate.warning)).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: D.validate.confirm }).click();
  await expect(section(page).getByText(fill(R.validate.done, { name: row.name }))).toBeVisible();
  await expect(rowOf(page, row.name)).toContainText('Versión 1 · Validada');
}

async function readDownload(download: import('@playwright/test').Download): Promise<string> {
  const path = await download.path();
  return readFileSync(path, 'utf8');
}
const tracks = (gpx: string) => [...gpx.matchAll(/<trk><name>([^<]*)<\/name>/g)].map((match) => match[1]!);

test('the coordinator builds the mission: generates, is warned, adds from the library, validates, compares, marks one unavailable and activates', async ({ page }, info) => {
  await login(page, ACCOUNTS.coordinator);
  run.mission = await createMission(page, nameOf(info, 'misión'), [{ ...WEST, name: 'Origen oeste (ficticio)' }]);
  await page.goto(`/missions/${run.mission}`);
  await expect(section(page).getByText(R.empty)).toBeVisible();

  // Generar desde la misión: las alternativas quedan en ella con su versión 1 fijada.
  await page.locator('.detail-generate').getByRole('link', { name: G.cta }).click();
  await page.getByLabel(G.nameLabel).fill(nameOf(info, 'oeste'));
  await page.getByRole('button', { name: G.submit }).click();
  await expect(page.getByRole('region', { name: G.compareTitle })).toBeVisible({ timeout: 60_000 });
  await page.goto(`/missions/${run.mission}`);
  const generated = await staffRows(page);
  expect(generated.length).toBeGreaterThanOrEqual(2);
  run.first = generated[0]!;
  run.second = generated[1]!;
  const table = section(page).getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(generated.length + 1);
  for (const row of generated) await expect(rowOf(page, row.name)).toContainText('Versión 1 · Borrador');
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);

  // Sin ninguna ruta validada la app avisa y pide confirmar: se dice que no y la misión sigue en planificación.
  await page.getByRole('button', { name: L.activate, exact: true }).click();
  const warning = page.getByRole('dialog', { name: L.activateWarning.title });
  await expect(warning).toContainText(L.activateWarning.body);
  await warning.getByRole('button', { name: L.activateWarning.cancel }).click();
  await expect(page.getByText(es.missions.status.planning).first()).toBeVisible();

  // Añadir una ruta de la biblioteca (un borrador sembrado): la versión que fija la misión y la repetida marcada.
  await section(page).getByRole('button', { name: A.open }).click();
  const dialog = page.getByRole('dialog', { name: A.title });
  await dialog.getByLabel(es.routes.searchLabel).fill('Variante de la Pradera');
  await dialog.getByRole('button', { name: es.routes.searchSubmit }).click();
  const pick = dialog.getByRole('checkbox', { name: fill(A.pick, { name: 'Variante de la Pradera (ficticia)' }) });
  await pick.check();
  await dialog.getByRole('button', { name: A.continue }).click();
  await expect(dialog.getByText(A.details.draftWarning)).toBeVisible(); // la ruta solo tiene un borrador: el rescatista no lo verá
  await dialog.getByRole('button', { name: fill(A.submit, { count: 1 }) }).click();
  await expect(section(page).getByText(fill(A.added, { count: 1 }))).toBeVisible();
  await expect(rowOf(page, 'Variante de la Pradera')).toContainText(R.notices.draft);
  await section(page).getByRole('button', { name: A.open }).click();
  const again = page.getByRole('dialog', { name: A.title });
  await again.getByLabel(es.routes.searchLabel).fill('Variante de la Pradera');
  await again.getByRole('button', { name: es.routes.searchSubmit }).click();
  const repeated = again.getByRole('checkbox', { name: fill(A.pick, { name: 'Variante de la Pradera (ficticia)' }) });
  await expect(repeated).toBeDisabled();
  await expect(again.getByText(A.inMission)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Validar dos desde la propia misión (el aviso de RF-506 se confirma): la otra generada, si la hay, y la de la biblioteca siguen en borrador.
  await validateFromRow(page, run.first);
  await validateFromRow(page, run.second);
  await expect.poll(async () => (await staffRows(page)).filter((row) => row.pinned.status === 'validated').length).toBe(2);

  // Compararlas: marcar las dos las pone en el mapa y saca el perfil de cada una.
  for (const row of [run.first, run.second])
    await section(page)
      .getByRole('checkbox', { name: fill(R.select, { name: row.name }) })
      .check();
  await expect(section(page).getByRole('img', { name: new RegExp(`^${D.profile.title}`) })).toHaveCount(2);
  await expect(section(page).getByRole('heading', { level: 4, name: fill(R.profiles.forRoute, { name: run.first.name, number: 1 }) })).toBeVisible();
  await expect(rowOf(page, run.first.name)).toContainText(/\d,\d km/);

  // Marcar la segunda como no disponible: queda señalada en la misión.
  await rowOf(page, run.second.name)
    .getByRole('button', { name: fill(R.unavailable.markFor, { name: run.second.name }) })
    .click();
  await expect(section(page).getByText(fill(R.unavailable.marked, { name: run.second.name }))).toBeVisible();
  await expect(rowOf(page, run.second.name)).toContainText(R.badges.unavailable);

  // Con una validada disponible ya no hace falta confirmar: se activa y la misión lo dice.
  await page.getByRole('button', { name: L.activate, exact: true }).click();
  await expect(page.getByText(L.activated)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const final = await staffRows(page);
  expect(final.find((row) => row.id === run.second!.id)!.status).toBe('unavailable');
  run.libraryRow = final.find((row) => row.name.startsWith('Variante'))!.id;
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(page);
});

test('the rescuer, with the keyboard and in French, sees only the validated and pinned routes, shares the location and downloads the GPX', async ({ roleContext }, info) => {
  const page = await openSession(roleContext, ACCOUNTS.rescuer, { permissions: ['clipboard-read', 'clipboard-write'] });
  // La elección de idioma vive en este navegador (D-H0-21): no cambia la cuenta de nadie.
  await page.evaluate(() => localStorage.setItem('onway.locale', 'fr'));
  await page.goto(`/missions/${run.mission}`);
  const F = fr.myMissions;
  await expect(page.getByRole('heading', { level: 1, name: nameOf(info, 'misión') })).toBeVisible();
  const routes = page.getByRole('region', { name: F.detail.routesTitle, exact: true });
  await expect(routes.getByRole('heading', { level: 3 })).toHaveCount(2); // las dos validadas; el borrador de la biblioteca no está
  const firstCard = routes.locator('.my-route-card', { hasText: run.first!.name });
  const secondCard = routes.locator('.my-route-card', { hasText: run.second!.name });
  await expect(routes.getByText('Variante de la Pradera')).toHaveCount(0);

  // La disponible lleva sus datos y sus descargas; la no disponible, el aviso y ninguna descarga.
  await expect(firstCard).toContainText(/\d,\d km/);
  await expect(firstCard.getByRole('img', { name: /Type de voie/ })).toBeVisible();
  await expect(firstCard.getByRole('button', { name: /Télécharger/ })).toHaveCount(2);
  await expect(secondCard).toContainText(F.routes.unavailable);
  await expect(secondCard).toContainText(F.routes.unavailableNotice);
  await expect(secondCard.getByRole('button', { name: /Télécharger/ })).toHaveCount(0);

  // El servidor lo confirma: ni borradores ni notas ni quién validó, y la geometría de una ruta oculta no existe.
  const mine = await apiGet<{ items: { id: string; name: string; status: string }[] }>(page, `/my/missions/${run.mission}/routes`);
  expect(mine.items.map((item) => item.name).sort()).toEqual([run.first!.name, run.second!.name].sort());
  expect(JSON.stringify(mine)).not.toMatch(/"note"|validatedBy|"draft"/);
  expect((await page.request.get(`/api/v1/my/missions/${run.mission}/routes/${run.libraryRow}/geometry`)).status()).toBe(404);

  // Compartir la ubicación del objetivo solo con teclado: copia las coordenadas y lo anuncia.
  const share = page.getByRole('region', { name: F.share.title, exact: true });
  await tabTo(page, share.getByRole('button', { name: F.share.copy }));
  await page.keyboard.press('Enter');
  await expect(share.getByRole('status')).toHaveText(fill(F.share.copied, { value: TARGET_TEXT }));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TARGET_TEXT);
  await expect(share.getByRole('link', { name: F.share.open })).toHaveAttribute('href', `geo:${TARGET.lat},${TARGET.lon}`);

  // Elegir la ruta con el teclado saca su perfil.
  const show = firstCard.getByRole('button', { name: fill(F.routes.showFor, { name: run.first!.name }) });
  await tabTo(page, show);
  await page.keyboard.press('Space');
  await expect(show).toHaveAttribute('aria-pressed', 'true');
  await expect(firstCard.getByRole('img', { name: new RegExp(`^${fr.routeDetail.profile.title}`) }).first()).toBeVisible();

  // Descargar el GPX de la ruta: solo ella, sin autor ni correo.
  const single = firstCard.getByRole('button', { name: fill(F.routes.downloadFor, { name: run.first!.name, format: 'GPX' }) });
  await tabTo(page, single);
  const [oneFile] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const one = await readDownload(oneFile);
  expect(oneFile.suggestedFilename()).toMatch(/^onway-itineraire-.*\.gpx$/);
  expect(tracks(one)).toEqual([run.first!.name]);
  expect(one).not.toMatch(/<author|<email|<link|@/);

  // Descargar todas: la disponible, sin la no disponible ni los borradores.
  const all = routes.getByRole('button', { name: fill(F.routes.downloadAll, { format: 'GPX' }) });
  await tabTo(page, all);
  const [allFile] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const everything = await readDownload(allFile);
  expect(tracks(everything)).toEqual([run.first!.name]);
  expect(everything).not.toContain('borrador sin validar');
  await expect(routes.getByText(F.routes.downloaded)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('a newer validated version never changes the mission by itself: the rescuer keeps the pinned one until the coordinator updates', async ({ page, roleContext }, info) => {
  await login(page, ACCOUNTS.coordinator);
  const first = run.first!;
  // Editar la ruta (una versión nueva a partir de la 1) y validarla: se hace por el API, el editor ya lo cubre la demostración de H2.
  const detail = await apiGet<{ versions: { id: string }[] }>(page, `/routes/${first.routeId}`);
  const base = await apiGet<{ geometry: { coordinates: number[][] } }>(page, `/routes/${first.routeId}/versions/${detail.versions[0]!.id}`);
  const edited = base.geometry.coordinates.map(([lon, lat], index) => [lon!, index === 1 ? lat! + 0.0002 : lat!]);
  const created = await apiPost<{ versionId: string; versionNumber: number }>(page, `/routes/${first.routeId}/versions`, {
    baseVersionId: detail.versions[0]!.id,
    geometry: { type: 'LineString', coordinates: edited },
  });
  expect(created.versionNumber).toBe(2);
  await apiPost(page, `/routes/${first.routeId}/versions/${created.versionId}/validate`, { acknowledged: true });

  // La misión sigue con la versión 1 y avisa de la 2.
  await page.goto(`/missions/${run.mission}`);
  await expect(rowOf(page, first.name)).toContainText('Versión 1 · Validada');
  await expect(rowOf(page, first.name)).toContainText(fill(R.notices.newer, { number: 2 }));
  expect((await staffRows(page)).find((row) => row.id === first.id)!.pinned.number).toBe(1);

  // El rescatista sigue viendo la fijada.
  const rescuer = await openSession(roleContext, ACCOUNTS.rescuer);
  await rescuer.goto(`/missions/${run.mission}`);
  const card = rescuer.locator('.my-route-card', { hasText: first.name });
  await expect(card).toContainText(/Versión 1 · validada el/);
  await expect(card).not.toContainText(/Versión 2/);

  // El coordinador actualiza, con confirmación, y entonces el rescatista ve la nueva.
  await rowOf(page, first.name)
    .getByRole('button', { name: fill(R.update.actionFor, { name: first.name, number: 2 }) })
    .click();
  await page.getByRole('button', { name: R.update.yes }).click();
  await expect(section(page).getByText(fill(R.update.done, { name: first.name, number: 2 }))).toBeVisible();
  await expect(rowOf(page, first.name)).toContainText('Versión 2 · Validada');
  await expect(rowOf(page, first.name)).not.toContainText(fill(R.notices.newer, { number: 2 }));
  await rescuer.reload();
  await expect(rescuer.locator('.my-route-card', { hasText: first.name })).toContainText(/Versión 2 · validada el/);
  if (info.project.name === 'mobile') await expectNoHorizontalOverflow(rescuer);
});

test('a route in an open mission is not archived, another organization gets 404 and a mission in planning does not exist for the rescuer', async ({ page, roleContext }, info) => {
  await login(page, ACCOUNTS.coordinator);
  const first = run.first!;

  // INV-07: la ruta está en una misión abierta, así que no se archiva (y el mensaje dice en cuál).
  await page.goto(`/routes/${first.routeId}`);
  await chooseMenuItem(page, es.common.more, D.actions.archive);
  const archive = page.getByRole('dialog', { name: D.archive.title });
  await archive.getByRole('button', { name: D.archive.confirm }).click();
  await expect(archive.getByRole('alert')).toContainText(new RegExp(escape(nameOf(info, 'misión'))));
  await archive.getByRole('button', { name: D.archive.cancel }).click();

  // Otra organización: la misión, sus rutas, su geometría y su exportación no existen (INV-01).
  const other = await openSession(roleContext, { email: ORG_B.adminEmail, password: ORG_B.password });
  for (const path of [`/missions/${run.mission}`, `/missions/${run.mission}/routes`, `/missions/${run.mission}/routes/${first.id}/geometry`, `/missions/${run.mission}/routes/export`]) {
    expect((await other.request.get(`/api/v1${path}`)).status(), path).toBe(404);
  }

  // RN-16: una misión en planificación con una ruta validada no existe para el rescatista.
  run.planning = await createMission(page, nameOf(info, 'en planificación'), [{ ...WEST, name: 'Origen oeste (ficticio)' }]);
  await apiSend(page, 'POST', `/missions/${run.planning}/routes`, { items: [{ routeId: first.routeId }] }, 201);
  const rescuer = await openSession(roleContext, ACCOUNTS.rescuer);
  for (const path of [`/my/missions/${run.planning}`, `/my/missions/${run.planning}/routes`, `/my/missions/${run.planning}/routes/export`]) {
    expect((await rescuer.request.get(`/api/v1${path}`)).status(), path).toBe(404);
  }
  // Y el rescatista no escribe en las rutas de la misión (el servidor lo decide).
  const csrf = (await (await rescuer.request.get('/api/v1/auth/me')).json()).csrfToken as string;
  const write = await rescuer.request.post(`/api/v1/missions/${run.mission}/routes`, { data: { items: [{ routeId: first.routeId }] }, headers: { 'X-CSRF-Token': csrf } });
  expect(write.status()).toBe(403);
});

test('closing the mission leaves the routes readable for the rescuer but no longer downloadable', async ({ page, roleContext }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/missions/${run.mission}`);
  await page.getByRole('button', { name: L.close, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: L.closeDialog.title });
  await dialog.getByRole('button', { name: L.closeDialog.confirm }).click();
  await expect(page.getByText(L.closed)).toBeVisible();
  // Cerrada, la tabla del coordinador es de lectura: ningún control que escriba.
  await expect(section(page).getByRole('button', { name: A.open })).toHaveCount(0);
  await expect(rowOf(page, run.first!.name).getByRole('button', { name: /Quitar|Marcar|Validar|Actualizar/ })).toHaveCount(0);

  const rescuer = await openSession(roleContext, ACCOUNTS.rescuer);
  await rescuer.goto(`/missions/${run.mission}`);
  const routes = rescuer.getByRole('region', { name: es.myMissions.detail.routesTitle, exact: true });
  await expect(routes.getByRole('heading', { level: 3 })).toHaveCount(2);
  await expect(routes.getByText(es.myMissions.routes.closedNotice)).toBeVisible();
  await expect(routes.getByRole('button', { name: /Descargar/ })).toHaveCount(0);
  expect((await rescuer.request.get(`/api/v1/my/missions/${run.mission}/routes/export`)).status()).toBe(409);
});
