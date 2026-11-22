// Demostración de `H5-perfil` (doc 07 §3, plan §7) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// Todo es ficticio. Una persona recién aprobada como rescatista (cuenta «E2E …», creada como la deja la aprobación: ver `createApprovedRescuer`):
//   1. Alta obligatoria: entra y cae en «Completa tu perfil»; la barra solo tiene Mi perfil y Cuenta, y /missions la devuelve al alta.
//   2. El formulario rechaza un DNI con la letra mal (en el cliente) y el DNI de rescatista1 («ya registrado», sin decir de quién, INV-24);
//      con uno válido el perfil queda completo y entra en Mis misiones.
//   3. Mi perfil enseña el documento y la dirección ocultos; «Mostrar» los enseña enteros y «Ocultar» los vuelve a ocultar.
//   4. Elige el francés en Cuenta: se guarda en la cuenta y, al entrar en otro navegador, la aplicación ya sale en francés (D-P6).
//   5. Cambia la contraseña con otra sesión abierta: esa sesión se cierra, la actual sigue y solo la nueva contraseña abre sesión (D-P5).
//   6. Un coordinador no tiene vía a los datos sensibles: 403 en /my/profile/sensitive (INV-18).
// Al terminar, la cuenta queda DESACTIVADA (`retireE2eAccounts`; también en el `globalSetup` por si se interrumpe una ejecución).
import type { Page } from '@playwright/test';
import { ACCOUNTS, fr, heading, navLabels } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, openSession, test } from './support/demo';
import { createApprovedRescuer, retireE2eAccounts } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);
const P = es.profile;
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const tagOf = (info: { project: { name: string } }) => (info.project.name === 'desktop' ? 'd' : 'm');

/** Un DNI inventado y válido por ejecución y formato (nunca los 00000001 a 00000005 de la semilla): INV-24 no tropieza entre ejecuciones. */
function dniFor(seed: string): string {
  let n = 0;
  for (const char of seed) n = (n * 31 + char.charCodeAt(0)) % 89_999_999;
  const number = 10_000_000 + n;
  return `${number}${DNI_LETTERS[number % 23]}`;
}

const run = { email: '', name: '', password: `OnWay-perfil-${STAMP}-a`, newPassword: `OnWay-perfil-${STAMP}-b`, dni: '' };

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.beforeAll(async ({}, info) => {
  const tag = tagOf(info);
  run.email = `e2e-${tag}-${STAMP}-perfil@example.org`;
  run.name = `E2E ${tag} ${STAMP} Perfil`;
  run.dni = dniFor(`${tag}${STAMP}`);
  await createApprovedRescuer(run.email, run.name, run.password);
});

// eslint-disable-next-line no-empty-pattern -- ídem
test.afterAll(async ({}, info) => {
  await retireE2eAccounts(`e2e-${tagOf(info)}-${STAMP}-%@example.org`);
});

async function fillSignup(page: Page, document: string): Promise<void> {
  const field = (label: string) => page.getByLabel(label, { exact: true });
  await field(P.fields.fullName).fill(`${run.name} Completo`);
  await field(P.fields.documentType).selectOption('dni');
  await field(P.fields.documentNumber).fill(document);
  await field(P.fields.phone).fill('+34 600 000 900');
  await field(P.fields.street).fill('Calle Inventada de la Prueba');
  await field(P.fields.number).fill('9');
  await field(P.fields.postalCode).fill('22630');
  await field(P.fields.locality).fill('Biescas');
  await field(P.fields.province).fill('Huesca');
}

test('a newly approved rescuer must fill the signup first, and the form refuses a wrong letter and a document already registered', async ({ page }) => {
  await login(page, { email: run.email, password: run.password });
  await expect(page).toHaveURL(/\/profile$/);
  await expect(heading(page, P.completeTitle)).toBeVisible();
  expect(await navLabels(page)).toEqual([es.nav.myProfile, es.nav.account]);
  await expect(page.getByLabel(P.fields.email, { exact: true })).toHaveValue(run.email);
  await expect(page.getByText(P.whoSees)).toBeVisible();

  // Cualquier otra vista lleva al alta (P1).
  await page.goto('/missions');
  await expect(page).toHaveURL(/\/profile$/);
  await expect(heading(page, P.completeTitle)).toBeVisible();

  // La letra del DNI mal: lo dice el cliente, sin enviar nada.
  const wrong = `${run.dni.slice(0, 8)}${DNI_LETTERS[(DNI_LETTERS.indexOf(run.dni.slice(-1)) + 1) % 23]}`;
  await fillSignup(page, wrong);
  let patched = false;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith('/api/v1/my/profile')) patched = true;
  });
  await page.getByRole('button', { name: P.save }).click();
  await expect(page.getByText(P.errors.invalidDocument)).toBeVisible();
  await expect(page.getByLabel(P.fields.documentNumber, { exact: true })).toBeFocused();
  expect(patched).toBe(false);

  // El DNI de rescatista1 (semilla): ya está en la organización. El servidor lo rechaza sin decir de quién es.
  await page.getByLabel(P.fields.documentNumber, { exact: true }).fill('00000001R');
  const refused = page.waitForResponse((response) => response.url().endsWith('/api/v1/my/profile') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: P.save }).click();
  const response = await refused;
  expect(response.status()).toBe(409);
  const body = JSON.stringify(await response.json());
  expect(body).toContain('DOCUMENT_ALREADY_REGISTERED');
  expect(body).not.toContain('rescatista1');
  await expect(page.getByText(P.errors.documentTaken)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Con un DNI válido y libre, el perfil queda completo y se abre el resto de la aplicación.
  await page.getByLabel(P.fields.documentNumber, { exact: true }).fill(run.dni);
  await page.getByRole('button', { name: P.save }).click();
  await expect(page).toHaveURL(/\/missions$/);
  await expect(heading(page, es.myMissions.title)).toBeVisible();
  expect(await navLabels(page)).toEqual([es.nav.missions, es.nav.myProfile, es.nav.account]);
});

test('My profile hides the document and the address until Show, and hides them again', async ({ page }) => {
  await login(page, { email: run.email, password: run.password });
  await page.goto('/profile');
  await expect(heading(page, P.title)).toBeVisible();
  const sensitive = page.getByRole('region', { name: P.blocks.sensitive, exact: true });
  await expect(sensitive.getByText(`•••••••${run.dni.slice(-2)}`)).toBeVisible();
  await expect(sensitive.getByText('•••••, 22630 Biescas (ES)')).toBeVisible();
  await expect(page.getByText(run.dni)).toHaveCount(0);

  await sensitive.getByRole('button', { name: P.view.show }).click();
  await expect(sensitive.getByText(run.dni)).toBeVisible();
  await expect(sensitive.getByText(/Calle Inventada de la Prueba 9, 22630 Biescas, Huesca/)).toBeVisible();
  await sensitive.getByRole('button', { name: P.view.hide }).click();
  await expect(page.getByText(run.dni)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('the language chosen in Account is saved in the account: another browser opens in French', async ({ page, roleContext }) => {
  await login(page, { email: run.email, password: run.password });
  await page.goto('/account');
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/me') && response.request().method() === 'PATCH');
  await page.getByRole('radio', { name: es.account.languageFr }).check();
  expect((await saved).status()).toBe(200);
  await expect(heading(page, fr.account.title)).toBeVisible();

  // Otro navegador, sin nada guardado: la aplicación sale en el idioma de la cuenta.
  const other = await openSession(roleContext, { email: run.email, password: run.password });
  await expect(heading(other, fr.myMissions.title)).toBeVisible();

  // Se deja en español para lo que sigue.
  await page.getByRole('radio', { name: fr.account.languageEs }).check();
  await expect(heading(page, es.account.title)).toBeVisible();
});

test('changing the password closes the other session, keeps this one, and only the new password opens a session', async ({ page, roleContext }) => {
  await login(page, { email: run.email, password: run.password });
  const other = await openSession(roleContext, { email: run.email, password: run.password });
  await page.goto('/account');
  const section = page.getByRole('region', { name: es.account.password.title, exact: true });
  await section.getByLabel(es.account.password.current, { exact: true }).fill(run.password);
  await section.getByLabel(es.account.password.next, { exact: true }).fill(run.newPassword);
  await section.getByLabel(es.account.password.confirm, { exact: true }).fill(run.newPassword);
  await section.getByRole('button', { name: es.account.password.submit }).click();
  await expect(section.getByText(es.account.password.done)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Esta sesión sigue; la otra ya no vale.
  await page.goto('/profile');
  await expect(heading(page, P.title)).toBeVisible();
  await other.goto('/profile');
  await expect(other).toHaveURL(/\/login/);

  // Solo la nueva abre sesión.
  const third = await (await roleContext()).newPage();
  await third.goto('/login');
  await third.getByLabel(es.login.email).fill(run.email);
  await third.getByLabel(es.login.password).fill(run.password);
  await third.getByRole('button', { name: es.login.submit }).click();
  await expect(third.getByText(es.errors.INVALID_CREDENTIALS)).toBeVisible();
  await login(third, { email: run.email, password: run.newPassword });
  await expect(third).toHaveURL(/\/missions$/);
});

test('a coordinator has no way to the sensitive data (INV-18)', async ({ roleContext }) => {
  const coordinator = await openSession(roleContext, ACCOUNTS.coordinator);
  const response = await coordinator.request.get('/api/v1/my/profile/sensitive');
  expect(response.status()).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
});
