// Demostración de `H5-usuarios` (doc 07 §3, plan §1) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// Todo es ficticio. El administrador (`admin@example.org`), en Administración → Usuarios:
//   1. Busca a `rescatista1`, filtra por rol y por estado, abre su ficha (correo, teléfono, cursos y habilidades, equipos) y abre su
//      certificado: queda una fila `certificate_opened` con el administrador como actor.
//   2. A un rescatista creado por la prueba le cambia el rol a coordinador: la auditoría tiene `role_changed` con `{from, to}`.
//   3. Intenta desactivar a un coordinador creado por la prueba que es responsable de una misión abierta: la app pide reasignarla; al
//      confirmar, la cuenta queda desactivada, la misión pasa a `coordinador@example.org` (con su `mission_updated`) y la sesión de la
//      persona desactivada ya no vale ni puede entrar.
//   4. La reactiva (`account_active`).
//   5. Intenta quitarse a sí mismo el rol de administrador y desactivarse: `LAST_ADMIN`, y no cambia nada.
//   6. Una pasada solo con teclado y en francés: abre y cancela «Cambiar el rol» y desactiva a otra cuenta de la prueba.
// Solo toca cuentas `e2e-…` y misiones «E2E …»: al terminar, las cuentas quedan DESACTIVADAS (`retireE2eAccounts`) y la misión CERRADA
// (`closeLeftoverE2eMissions`). Nunca cambia ni desactiva cuentas de la semilla. La auditoría es de solo añadir: sus filas se quedan.
import type { Page } from '@playwright/test';
import { ACCOUNTS, fr, heading } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, openSession, tabTo, test } from './support/demo';
import { auditRowsAbout, closeLeftoverE2eMissions, createApprovedAccount, createE2eMission, demo, missionResponsible, missionUpdates, retireE2eAccounts } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);
const U = es.admin.users;
const A = es.admin.user;
const COORDINATOR = demo.members.find((m) => m.email === 'coordinador@example.org')!;
const ADMIN = demo.members.find((m) => m.role === 'admin')!;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const tagOf = (info: { project: { name: string } }) => (info.project.name === 'desktop' ? 'd' : 'm');
const password = `OnWay-usuarios-${STAMP}-a`;
const run = {
  tag: '',
  promote: { email: '', name: '' },
  lead: { email: '', name: '', mission: '' },
  keys: { email: '', name: '' },
};

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.beforeAll(async ({}, info) => {
  const tag = tagOf(info);
  run.tag = tag;
  run.promote = { email: `e2e-${tag}-${STAMP}-asc@example.org`, name: `E2E ${tag} ${STAMP} Ascenso` };
  run.lead = { email: `e2e-${tag}-${STAMP}-resp@example.org`, name: `E2E ${tag} ${STAMP} Responsable`, mission: `E2E ${tag} ${STAMP} Usuarios` };
  run.keys = { email: `e2e-${tag}-${STAMP}-tecl@example.org`, name: `E2E ${tag} ${STAMP} Teclado` };
  await createApprovedAccount(run.promote.email, run.promote.name, password, 'rescuer');
  await createApprovedAccount(run.lead.email, run.lead.name, password, 'coordinator');
  await createApprovedAccount(run.keys.email, run.keys.name, password, 'rescuer');
});

// eslint-disable-next-line no-empty-pattern -- ídem
test.afterAll(async ({}, info) => {
  const tag = tagOf(info);
  await closeLeftoverE2eMissions(`E2E ${tag} ${STAMP} %`);
  await retireE2eAccounts(`e2e-${tag}-${STAMP}-%@example.org`);
});

const usersSection = (page: Page) => page.getByRole('region', { name: U.title, exact: true });

/** Busca a una persona por su correo en la lista de usuarios y abre su ficha. */
async function openPerson(page: Page, email: string, name: string): Promise<void> {
  await page.goto('/admin');
  const users = usersSection(page);
  await users.getByRole('searchbox', { name: U.searchLabel }).fill(email);
  await users.getByRole('button', { name: U.searchSubmit }).click();
  await users.getByRole('link', { name, exact: true }).click();
  await expect(heading(page, name)).toBeVisible();
}

const contact = (page: Page) => page.getByRole('region', { name: A.contact, exact: true });
const dialogOf = (page: Page, title: string) => page.getByRole('dialog', { name: title });

test('the administrator searches and filters the users, opens a profile and its certificate (audited)', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.admin);
  await page.goto('/admin');
  const users = usersSection(page);
  // La lista crece con las cuentas «E2E …» de ejecuciones anteriores (20 por página): basta con que haya filas.
  await expect(users.getByRole('link').first()).toBeVisible();

  await users.getByRole('searchbox', { name: U.searchLabel }).fill('rescatista1');
  await users.getByRole('button', { name: U.searchSubmit }).click();
  await users.getByLabel(U.roleFilter, { exact: true }).selectOption('rescuer');
  await users.getByLabel(U.statusFilter, { exact: true }).selectOption('active');
  await expect(page).toHaveURL(/users\.q=rescatista1/);
  await expect(page).toHaveURL(/users\.role=rescuer/);
  await expect(page).toHaveURL(/users\.status=active/);
  const found = users.getByRole('link', { name: 'Aitor Lasierra Gil', exact: true });
  await expect(found).toBeVisible();
  await expect(users.getByRole('link', { name: ADMIN.displayName, exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await found.click();
  await expect(heading(page, 'Aitor Lasierra Gil')).toBeVisible();
  await expect(contact(page).getByText('rescatista1@example.org')).toBeVisible();
  await expect(contact(page).getByText('+34 600 000 101')).toBeVisible();
  const skills = page.getByRole('region', { name: A.skills, exact: true });
  await expect(skills.getByText('Primeros auxilios en montaña')).toBeVisible();
  await expect(skills.getByText(A.certificateNotice)).toBeVisible();
  await expect(page.getByRole('region', { name: A.teams, exact: true })).toBeVisible();
  // Documento y dirección nunca salen en la ficha (regla 3).
  await expect(page.getByText(/00000001R|Calle del Ibón Inventado/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const before = (await auditRowsAbout('rescatista1@example.org', 'certificate_opened')).length;
  const certificate = page.context().waitForEvent('response', (response) => /\/api\/v1\/certificates\//.test(response.url()));
  const popup = page.context().waitForEvent('page');
  await skills.getByRole('button', { name: es.profile.skills.openFor.replace('{{name}}', 'Primeros auxilios en montaña') }).click();
  expect((await certificate).status()).toBe(200);
  await (await popup).close();
  const rows = await auditRowsAbout('rescatista1@example.org', 'certificate_opened');
  expect(rows.length).toBeGreaterThan(before);
  expect(rows.at(-1)!.actor).toBe(ADMIN.email);
});

test('changing a rescuer to coordinator leaves role_changed in the audit log', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.admin);
  await openPerson(page, run.promote.email, run.promote.name);
  await expect(contact(page).getByText(es.account.roleRescuer, { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: A.changeRole, exact: true }).click();
  const dialog = dialogOf(page, A.roleDialog.title.replace('{{name}}', run.promote.name));
  await expect(dialog.getByRole('button', { name: A.cancel })).toBeFocused();
  // Ninguna opción viene marcada: sin elegir, avisa.
  await dialog.getByRole('button', { name: A.roleDialog.confirm }).click();
  await expect(dialog.getByText(A.roleDialog.roleRequired)).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(`^${es.account.roleCoordinator}`) }).check();
  await expect(dialog.getByText(es.admin.signups.approveDialog.coordinatorWarning)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: A.roleDialog.confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(A.done.roleChanged.replace('{{role}}', es.account.roleCoordinator))).toBeVisible();
  await expect(contact(page).getByText(es.account.roleCoordinator, { exact: true }).first()).toBeVisible();

  const rows = await auditRowsAbout(run.promote.email, 'role_changed');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.actor).toBe(ADMIN.email);
  expect(rows[0]!.detail).toEqual({ from: 'rescuer', to: 'coordinator' });
});

test('disabling a coordinator who leads an open mission asks for a new lead, moves the mission and locks the account out', async ({ page, roleContext }) => {
  // La persona de la prueba entra, crea una misión «E2E …» (es su responsable) y deja la sesión abierta.
  await login(page, { email: run.lead.email, password });
  await createE2eMission(page, run.lead.mission);
  expect(await missionResponsible(run.lead.mission)).toBe(run.lead.email);

  const admin = await openSession(roleContext, ACCOUNTS.admin);
  await openPerson(admin, run.lead.email, run.lead.name);
  await admin.getByRole('button', { name: A.disable, exact: true }).click();
  const dialog = dialogOf(admin, A.disableDialog.title.replace('{{name}}', run.lead.name));
  await expect(dialog.getByText(A.reassign.count.replace('{{count}}', '1'))).toBeVisible();
  const select = dialog.getByRole('combobox', { name: A.reassign.label });
  await expect(select.getByRole('option', { name: run.lead.name })).toHaveCount(0);
  await dialog.getByRole('button', { name: A.disableDialog.confirm }).click();
  await expect(dialog.getByText(A.reassign.required)).toBeVisible();
  await expectNoHorizontalOverflow(admin);
  await select.selectOption({ label: COORDINATOR.displayName });
  await dialog.getByRole('button', { name: A.disableDialog.confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(admin.getByText(A.done.disabled)).toBeVisible();
  await expect(contact(admin).getByText(U.status.disabled, { exact: true }).first()).toBeVisible();

  expect(await missionResponsible(run.lead.mission)).toBe(COORDINATOR.email);
  const updates = await missionUpdates(run.lead.mission);
  expect(updates.some((detail) => JSON.stringify(detail).includes('coordinatorId'))).toBe(true);
  expect((await auditRowsAbout(run.lead.email, 'account_disabled')).length).toBe(1);

  // La sesión de la persona desactivada ya no vale, y tampoco puede volver a entrar.
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  const other = await (await roleContext()).newPage();
  await other.goto('/login');
  await other.getByLabel(es.login.email).fill(run.lead.email);
  await other.getByLabel(es.login.password).fill(password);
  const attempt = other.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login'));
  await other.getByRole('button', { name: es.login.submit }).click();
  expect((await attempt).status()).toBeGreaterThanOrEqual(400);
  await expect(other).toHaveURL(/\/login/);
});

test('reactivating the account leaves account_active', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.admin);
  await openPerson(page, run.lead.email, run.lead.name);
  await expect(page.getByRole('button', { name: A.disable, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: A.reactivate, exact: true }).click();
  const dialog = dialogOf(page, A.reactivateDialog.title.replace('{{name}}', run.lead.name));
  await expect(dialog.getByRole('button', { name: A.cancel })).toBeFocused();
  await dialog.getByRole('button', { name: A.reactivateDialog.confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(A.done.reactivated)).toBeVisible();
  await expect(contact(page).getByText(U.status.active, { exact: true }).first()).toBeVisible();
  expect((await auditRowsAbout(run.lead.email, 'account_active')).length).toBe(1);
  await expectNoHorizontalOverflow(page);
});

test('the only administrator cannot lose the role or be disabled (LAST_ADMIN): nothing changes', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.admin);
  const before = (await auditRowsAbout(ADMIN.email, 'role_changed')).length;
  await openPerson(page, ADMIN.email, ADMIN.displayName);

  await page.getByRole('button', { name: A.changeRole, exact: true }).click();
  const role = dialogOf(page, A.roleDialog.title.replace('{{name}}', ADMIN.displayName));
  await role.getByRole('radio', { name: new RegExp(`^${es.account.roleRescuer}`) }).check();
  await role.getByRole('button', { name: A.roleDialog.confirm }).click();
  await expect(role.getByText(A.lastAdmin)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await role.getByRole('button', { name: A.cancel }).click();
  await expect(role).toHaveCount(0);

  await page.getByRole('button', { name: A.disable, exact: true }).click();
  const disable = dialogOf(page, A.disableDialog.title.replace('{{name}}', ADMIN.displayName));
  await disable.getByRole('button', { name: A.disableDialog.confirm }).click();
  await expect(disable.getByText(A.lastAdmin)).toBeVisible();
  await disable.getByRole('button', { name: A.cancel }).click();

  await page.reload();
  await expect(contact(page).getByText(es.account.roleAdmin, { exact: true }).first()).toBeVisible();
  await expect(contact(page).getByText(U.status.active, { exact: true }).first()).toBeVisible();
  expect((await auditRowsAbout(ADMIN.email, 'role_changed')).length).toBe(before);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200);
});

test('keyboard only and in French: open and cancel «Changer le rôle», then disable another account', async ({ roleContext }) => {
  const page = await (await roleContext()).newPage();
  const F = fr.admin.user;
  // El francés se elige en el acceso, solo con teclado (es un ajuste del navegador: no toca la cuenta de la semilla).
  await page.goto('/login');
  await tabTo(page, page.getByLabel(es.account.languageEs));
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await tabTo(page, page.getByLabel(fr.login.email, { exact: true }));
  await page.keyboard.type(ACCOUNTS.admin.email);
  await tabTo(page, page.getByLabel(fr.login.password, { exact: true }));
  await page.keyboard.type(ACCOUNTS.admin.password);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));

  await page.goto(`/admin?users.q=${encodeURIComponent(run.keys.email)}`);
  await tabTo(page, page.getByRole('link', { name: run.keys.name, exact: true }));
  await page.keyboard.press('Enter');
  await expect(heading(page, run.keys.name)).toBeVisible();

  const changeRole = page.getByRole('button', { name: F.changeRole, exact: true });
  await tabTo(page, changeRole);
  await page.keyboard.press('Enter');
  const role = dialogOf(page, F.roleDialog.title.replace('{{name}}', run.keys.name));
  await expect(role.getByRole('button', { name: F.cancel })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(role).toHaveCount(0);
  await expect(changeRole).toBeFocused();

  const disable = page.getByRole('button', { name: F.disable, exact: true });
  await tabTo(page, disable);
  await page.keyboard.press('Enter');
  const dialog = dialogOf(page, F.disableDialog.title.replace('{{name}}', run.keys.name));
  await expect(dialog.getByRole('button', { name: F.cancel })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: F.disableDialog.confirm })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(F.done.disabled)).toBeFocused();
  await expect(page.getByRole('button', { name: F.reactivate, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
