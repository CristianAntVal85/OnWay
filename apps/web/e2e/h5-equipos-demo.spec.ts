// Demostración de `H5-equipos` (doc 07 §3, plan §1) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// Todo es ficticio. La historia:
//   1. Un coordinador abre Equipos y crea «E2E … Equipo» con su localidad: la app propone el código (Alicante → ALC), se puede corregir y se
//      puede dejar como estaba. Repetir el nombre o el código se rechaza (`DUPLICATE_NAME`) en el campo que toca.
//   2. Abre el equipo y añade a dos rescatistas con el selector (búsqueda, solo perfiles completos, sin contacto) y quita a uno.
//   3. En una misión «E2E …» activa asigna el equipo a una de sus rutas (RF-805).
//   4. Un rescatista que NO es miembro abre la misión y ve en la ruta el nombre y la localidad del equipo (D-34) y el alias del coordinador
//      responsable (Q-36). El alias del miembro, leído en la base, termina en el código del equipo.
//   5. El coordinador archiva el equipo: sale de Activos y queda en Archivados, y ya no admite miembros.
//   6. El administrador también gestiona los equipos (Q-12): lo ve, lo reactiva por la interfaz y lo archiva de nuevo; el rescatista recibe 403.
//   7. Una pasada solo con teclado y en francés: crea un equipo, abre su detalle, abre y cierra «Ajouter des membres» y lo archiva.
// Solo crea equipos «E2E …», cuentas `e2e-…` y misiones «E2E …»: al terminar los equipos quedan ARCHIVADOS (y con un código libre, para la
// siguiente ejecución: `archiveLeftoverE2eTeams`), las cuentas DESACTIVADAS y las misiones CERRADAS. La auditoría es de solo añadir.
import type { APIRequest, Page } from '@playwright/test';
import { ACCOUNTS, fr, heading } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, openSession, tabTo, test } from './support/demo';
import { archiveLeftoverE2eTeams, closeLeftoverE2eMissions, createApprovedAccount, createE2eMission, memberAlias, retireE2eAccounts } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);
const T = es.teams;
const D = T.detail;
const R = es.missionRoutes;
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const ROUTE = 'Pradera a la Brecha (ficticia)'; // la de la semilla, validada

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const tagOf = (info: { project: { name: string } }) => (info.project.name === 'desktop' ? 'd' : 'm');
/** Cada formato usa su localidad (y por tanto su código): los dos proyectos corren a la vez y el código es único en la organización. */
const PLACES = { d: { locality: 'Alicante', code: 'ALC', frLocality: 'Tarbes', frCode: 'TRB' }, m: { locality: 'Sallent', code: 'SLL', frLocality: 'Lourdes', frCode: 'LRD' } } as const;
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key]));

/** Un DNI inventado y válido por ejecución, formato y persona (nunca los de la semilla). */
function dniFor(seed: string): string {
  let n = 0;
  for (const char of seed) n = (n * 31 + char.charCodeAt(0)) % 89_999_999;
  const number = 10_000_000 + n;
  return `${number}${DNI_LETTERS[number % 23]}`;
}

const password = `OnWay-equipos-${STAMP}-a`;
const run = {
  tag: 'd' as 'd' | 'm',
  place: PLACES.d as (typeof PLACES)[keyof typeof PLACES],
  team: '',
  frTeam: '',
  mission: '',
  missionId: '',
  people: { ana: { email: '', name: '' }, bea: { email: '', name: '' }, otto: { email: '', name: '' } },
};

/** Completa el perfil de una cuenta por la API (como lo haría la persona en su alta) para que tenga alias (Q-36). */
async function completeProfile(baseURL: string, playwright: { request: APIRequest }, email: string, dni: string): Promise<void> {
  const api = await playwright.request.newContext({ baseURL });
  const login = await api.post('/api/v1/auth/login', { data: { email, password } });
  expect(login.status(), 'login').toBe(200);
  const csrf = ((await login.json()) as { csrfToken: string }).csrfToken;
  const update = await api.patch('/api/v1/my/profile', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      phone: '+34600000999',
      document: { type: 'dni', number: dni },
      address: { street: 'Calle Inventada', number: '1', postalCode: '22000', locality: 'Ciudad Ficticia', province: 'Huesca', country: 'ES' },
    },
  });
  expect(update.status(), await update.text()).toBe(200);
  await api.dispose();
}

test.beforeAll(async ({ playwright }, info) => {
  const tag = tagOf(info);
  run.tag = tag;
  run.place = PLACES[tag];
  run.team = `E2E ${tag} ${STAMP} Equipo ${run.place.locality}`;
  run.frTeam = `E2E ${tag} ${STAMP} Equipe`;
  run.mission = `E2E ${tag} ${STAMP} Equipos`;
  for (const [key, label] of [
    ['ana', 'Ana'],
    ['bea', 'Bea'],
    ['otto', 'Otto'],
  ] as const) {
    run.people[key] = { email: `e2e-${tag}-${STAMP}-eq${key}@example.org`, name: `E2E ${tag} ${STAMP} ${label}` };
    await createApprovedAccount(run.people[key].email, run.people[key].name, password, 'rescuer');
    await completeProfile(info.project.use.baseURL ?? 'http://localhost:8080', playwright, run.people[key].email, dniFor(`${tag}${STAMP}${key}`));
  }
});

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.afterAll(async ({}, info) => {
  const tag = tagOf(info);
  await closeLeftoverE2eMissions(`E2E ${tag} ${STAMP} %`);
  await archiveLeftoverE2eTeams(`E2E ${tag} ${STAMP} %`);
  await retireE2eAccounts(`e2e-${tag}-${STAMP}-%@example.org`);
});

async function apiSend<T>(page: Page, method: 'POST' | 'PATCH' | 'GET', url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as { csrfToken: string };
  const response = await page.request.fetch(`/api/v1${url}`, { method, data: body, headers: { 'X-CSRF-Token': me.csrfToken } });
  const text = await response.text();
  return { status: response.status(), body: (text ? JSON.parse(text) : null) as T };
}

const dialogOf = (page: Page, title: string) => page.getByRole('dialog', { name: title });
const rowOf = (page: Page, name: string) => page.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });

/** Abre Equipos y el detalle del equipo, buscándolo por el nombre de esta ejecución. */
async function openTeam(page: Page, name: string, tab: 'active' | 'archived' = 'active'): Promise<void> {
  await page.goto(`/teams?tab=${tab}&q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name, exact: true }).click();
  await expect(heading(page, name)).toBeVisible();
}

test('the coordinator creates a team: the code is proposed, can be corrected, and a repeated name or code is refused', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/teams');
  await expect(heading(page, T.title)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: T.createCta }).first().click();
  const dialog = dialogOf(page, T.form.createTitle);
  await expect(dialog.getByLabel(T.form.name, { exact: true })).toBeFocused();
  await dialog.getByLabel(T.form.name, { exact: true }).fill(run.team);
  await dialog.getByLabel(T.form.locality, { exact: true }).fill(run.place.locality);
  await expect(dialog.getByLabel(T.form.code, { exact: true })).toHaveValue(run.place.code); // propuesto
  await dialog.getByLabel(T.form.code, { exact: true }).fill('qqq');
  await expect(dialog.getByLabel(T.form.code, { exact: true })).toHaveValue('QQQ'); // se corrige y va en mayúsculas
  await dialog.getByLabel(T.form.locality, { exact: true }).fill(`${run.place.locality}x`);
  await expect(dialog.getByLabel(T.form.code, { exact: true })).toHaveValue('QQQ'); // lo corregido ya no se pisa
  await dialog.getByLabel(T.form.locality, { exact: true }).fill(run.place.locality);
  await dialog.getByLabel(T.form.code, { exact: true }).fill(run.place.code); // y se deja como estaba
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: T.form.saveCreate }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: T.createCta }).first()).toBeFocused();

  // La lista (activos) lo enseña con su localidad, código y miembros, y ningún dato de personas.
  await page.getByRole('searchbox', { name: T.searchLabel }).fill(run.team);
  await page.getByRole('button', { name: T.searchSubmit }).click();
  const row = rowOf(page, run.team);
  await expect(row).toContainText(fill(T.row.locality, run.place));
  await expect(row).toContainText(fill(T.row.members, { count: 0 }));
  await expectNoHorizontalOverflow(page);

  // El mismo nombre y, con otro nombre, el mismo código: el servidor lo rechaza y la app lo dice en el campo.
  await page.getByRole('button', { name: T.createCta }).first().click();
  const again = dialogOf(page, T.form.createTitle);
  await again.getByLabel(T.form.name, { exact: true }).fill(run.team.toUpperCase());
  await again.getByLabel(T.form.locality, { exact: true }).fill(run.place.locality);
  await again.getByRole('button', { name: T.form.saveCreate }).click();
  await expect(again.getByText(T.form.duplicateName)).toBeVisible();
  await again.getByLabel(T.form.name, { exact: true }).fill(`${run.team} otro`);
  await again.getByRole('button', { name: T.form.saveCreate }).click();
  await expect(again.getByText(T.form.duplicateCode)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await again.getByRole('button', { name: T.form.cancel }).click();
  await expect(again).toHaveCount(0);
});

test('the coordinator adds two rescuers with the picker (no contact data) and removes one', async ({ page }) => {
  const { ana, bea, otto } = run.people;
  await login(page, ACCOUNTS.coordinator);
  await openTeam(page, run.team);
  await expect(page.getByText(D.noMembers)).toBeVisible();

  await page.getByRole('button', { name: D.addMembers }).click();
  const dialog = dialogOf(page, fill(T.add.title, { name: run.team }));
  await expect(dialog.getByRole('searchbox', { name: T.add.searchLabel })).toBeFocused();
  await dialog.getByRole('searchbox', { name: T.add.searchLabel }).fill(`E2E ${run.tag} ${STAMP}`);
  await dialog.getByRole('button', { name: T.searchSubmit }).click();
  // Solo perfiles completos, con nombre y equipos: ni correo ni teléfono.
  for (const person of [ana, bea, otto]) await expect(dialog.getByRole('checkbox', { name: new RegExp(person.name) })).toBeVisible();
  await expect(dialog).not.toContainText(/@|\+34/);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('checkbox', { name: new RegExp(ana.name) }).check();
  await dialog.getByRole('checkbox', { name: new RegExp(bea.name) }).check();
  await expect(dialog.getByText(fill(T.add.selectionCount, { count: 2 }))).toBeVisible();
  await dialog.getByRole('button', { name: fill(T.add.confirm, { count: 2 }) }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(fill(D.done.added, { count: 2 }))).toBeVisible();
  const members = page.getByRole('region', { name: D.members, exact: true });
  await expect(members.getByText(ana.name)).toBeVisible();
  await expect(members.getByText(bea.name)).toBeVisible();
  await expect(members).not.toContainText(/@|\+34/);
  await expectNoHorizontalOverflow(page);

  // Quitar a Bea, con confirmación (el foco empieza en «Cancelar»).
  await members.getByRole('button', { name: fill(D.removeLabel, { name: bea.name }) }).click();
  const confirm = dialogOf(page, fill(D.removeDialog.title, { name: bea.name }));
  await expect(confirm.getByRole('button', { name: D.cancel })).toBeFocused();
  await confirm.getByRole('button', { name: D.removeDialog.confirm }).click();
  await expect(confirm).toHaveCount(0);
  await expect(members.getByRole('listitem').filter({ hasText: bea.name })).toHaveCount(0); // el aviso de «ya no es del equipo» sí nombra a Bea
  await expect(members.getByText(ana.name)).toBeVisible();
  await expect(members.getByRole('heading', { name: D.members })).toBeFocused();

  // El alias de Ana, leído de la base, lleva el código del equipo (Q-36); es fijo: seguir en el equipo no lo cambia.
  expect(await memberAlias(ana.email)).toMatch(new RegExp(`^[a-z]+\\d* ${run.place.code}$`));
  // Bea entró en su primer equipo antes de salir: su alias también quedó fijado con el código.
  expect(await memberAlias(bea.email)).toMatch(new RegExp(` ${run.place.code}$`));
  // Otto no es de ningún equipo: su alias, sin código.
  expect(await memberAlias(otto.email)).toMatch(/^[a-z]+\d*$/);
});

test('the coordinator assigns the team to a route of an active mission, and a rescuer who is not a member sees the team and the coordinator alias', async ({ page, roleContext }) => {
  const { otto } = run.people;
  await login(page, ACCOUNTS.coordinator);
  const missionId = await createE2eMission(page, run.mission);
  run.missionId = missionId;
  const found = await apiSend<{ items: { id: string; name: string }[] }>(page, 'GET', `/routes?q=${encodeURIComponent('Pradera a la Brecha')}`);
  const route = found.body.items.find((item) => item.name === ROUTE)!;
  expect(route).toBeTruthy();
  expect((await apiSend(page, 'POST', `/missions/${missionId}/routes`, { items: [{ routeId: route.id }] })).status).toBeLessThan(300);
  expect((await apiSend(page, 'POST', `/missions/${missionId}/activate`, {})).status).toBeLessThan(300);

  await page.goto(`/missions/${missionId}`);
  const section = page.getByRole('region', { name: R.title, exact: true });
  const select = section.getByRole('combobox', { name: fill(R.team.selectLabel, { name: ROUTE }) });
  await expect(select).toHaveValue('');
  await expect(select.getByRole('option', { name: fill(R.teamValue, { name: run.team, locality: run.place.locality }) })).toHaveCount(1);
  await select.selectOption({ label: fill(R.teamValue, { name: run.team, locality: run.place.locality }) });
  await expect(section.getByText(fill(R.team.done, { name: ROUTE }))).toBeVisible();
  await expect(select).not.toHaveValue('');
  await expectNoHorizontalOverflow(page);

  // El rescatista que no es miembro (Otto) abre la misión.
  const rescuer = await openSession(roleContext, { email: otto.email, password });
  const mine = await apiSend<{ items: { id: string; coordinatorName: string | null; coordinatorAlias: string | null }[] }>(rescuer, 'GET', '/my/missions');
  const item = mine.body.items.find((x) => x.id === missionId)!;
  expect(item.coordinatorName).toBeNull();
  expect(item.coordinatorAlias).toMatch(/^[a-z]+\d*/);
  await rescuer.goto(`/missions/${missionId}`);
  const card = rescuer.locator('.my-route-card', { hasText: ROUTE });
  await expect(card).toContainText(fill(es.myMissions.routes.team, { name: run.team, locality: run.place.locality }));
  await expect(rescuer.getByText(item.coordinatorAlias!, { exact: true })).toBeVisible();
  await expect(rescuer.getByText(ACCOUNTS.coordinator.email)).toHaveCount(0);
  await expectNoHorizontalOverflow(rescuer);
  // No es miembro y sigue sin ver quién lo es: los miembros no salen en ninguna respuesta suya.
  expect((await apiSend(rescuer, 'POST', '/teams', { name: 'E2E no', locality: 'X', code: 'XXX' })).status).toBe(403);
  expect((await apiSend(rescuer, 'GET', '/teams')).status).toBe(403);
});

test('the coordinator archives the team: it leaves the active list, stays under Archived and takes no more members', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await openTeam(page, run.team);
  await page.getByRole('button', { name: D.archive }).click();
  const dialog = dialogOf(page, fill(D.archiveDialog.title, { name: run.team }));
  await expect(dialog.getByRole('button', { name: D.cancel })).toBeFocused();
  await dialog.getByRole('button', { name: D.archiveDialog.confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(D.archivedNote)).toBeVisible();
  await expect(page.getByRole('button', { name: D.addMembers })).toHaveCount(0);
  await expect(page.getByRole('button', { name: D.reactivate })).toBeFocused();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/teams?q=${encodeURIComponent(run.team)}`);
  await expect(page.getByText(T.emptySearch.replace('{{query}}', run.team))).toBeVisible();
  await page.getByRole('tab', { name: T.tabs.archived }).click();
  await expect(rowOf(page, run.team)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the administrator also manages teams: sees it under Archived, reactivates it from the page and archives it again', async ({ page }) => {
  await login(page, ACCOUNTS.admin);
  await openTeam(page, run.team, 'archived');
  await page.getByRole('button', { name: D.reactivate }).click();
  await dialogOf(page, fill(D.reactivateDialog.title, { name: run.team }))
    .getByRole('button', { name: D.reactivateDialog.confirm })
    .click();
  await expect(page.getByRole('button', { name: D.addMembers })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // Y por la API, de nuevo archivado (la misma operación que usa la interfaz).
  const id = page.url().split('/').pop()!;
  const archived = await apiSend<{ status: string }>(page, 'PATCH', `/teams/${id}`, { status: 'archived' });
  expect(archived.status).toBe(200);
  expect(archived.body.status).toBe('archived');
});

test('keyboard only and in French: create a team, open it, open and close «Ajouter des membres» and archive it', async ({ page }) => {
  const F = fr.teams;
  await login(page, ACCOUNTS.coordinatorFr);
  await page.goto('/teams');
  await expect(heading(page, F.title)).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: F.createCta }).first());
  await page.keyboard.press('Enter');
  const dialog = dialogOf(page, F.form.createTitle);
  await expect(dialog.getByLabel(F.form.name, { exact: true })).toBeFocused();
  await page.keyboard.type(run.frTeam);
  await page.keyboard.press('Tab');
  await page.keyboard.type(run.place.frLocality);
  await expect(dialog.getByLabel(F.form.code, { exact: true })).toHaveValue(run.place.frCode);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);

  await page.goto(`/teams?q=${encodeURIComponent(run.frTeam)}`);
  await tabTo(page, page.getByRole('link', { name: run.frTeam, exact: true }));
  await page.keyboard.press('Enter');
  await expect(heading(page, run.frTeam)).toBeVisible();

  const add = page.getByRole('button', { name: F.detail.addMembers });
  await tabTo(page, add);
  await page.keyboard.press('Enter');
  await expect(dialogOf(page, fill(F.add.title, { name: run.frTeam })).getByRole('searchbox', { name: F.add.searchLabel })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: F.detail.archive }));
  await page.keyboard.press('Enter');
  const archive = dialogOf(page, fill(F.detail.archiveDialog.title, { name: run.frTeam }));
  await expect(archive.getByRole('button', { name: F.detail.cancel })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(archive.getByRole('button', { name: F.detail.archiveDialog.confirm })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(archive).toHaveCount(0);
  await expect(page.getByText(F.detail.archivedNote)).toBeVisible();
  await expect(page.getByRole('button', { name: F.detail.reactivate })).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
