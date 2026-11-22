// Demostración de `H5-habilidades` (doc 07 §3, plan §1) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// Todo es ficticio; el PDF y el PNG los genera esta prueba. Una persona aprobada como rescatista (cuenta «E2E …», `createApprovedRescuer`) con el
// perfil completado por la API (eso ya lo enseña `h5-perfil-demo.spec.ts`):
//   1. Añade un curso («Primeros auxilios en montaña») con fecha, caducidad y un certificado PDF, y una habilidad («Conducción 4x4») sin él.
//   2. Abre el certificado: una pestaña nueva recibe `application/pdf`.
//   3. Edita el curso y cambia el certificado por un PNG: la pestaña recibe `image/png`.
//   4. Elimina la habilidad.
//   5. El administrador pide el enlace de ese certificado: queda UNA fila `certificate_opened` (la suya, con `{fileId}` y sin el nombre del curso);
//      las dos aperturas del propio rescatista no dejaron ninguna (INV-26).
//   6. Una pasada solo con teclado y en francés: añadir una entrada y abrir y cerrar el diálogo de edición.
// Al terminar, la cuenta queda DESACTIVADA (`retireE2eAccounts`). Los archivos subidos y sus filas de auditoría se quedan (la auditoría es de solo añadir).
import type { Page } from '@playwright/test';
import { fr, heading } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, openSession, tabTo, test } from './support/demo';
import { ACCOUNTS } from './support/app';
import { auditRowsAbout, createApprovedRescuer, retireE2eAccounts } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);
const S = es.profile.skills;
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const COURSE = 'Primeros auxilios en montaña';
const COURSE_EDITED = 'Primeros auxilios en montaña (avanzado)';
const SKILL = 'Conducción 4x4';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const tagOf = (info: { project: { name: string } }) => (info.project.name === 'desktop' ? 'd' : 'm');

/** Un DNI inventado y válido por ejecución y formato (nunca los de la semilla). */
function dniFor(seed: string): string {
  let n = 0;
  for (const char of seed) n = (n * 31 + char.charCodeAt(0)) % 89_999_999;
  const number = 10_000_000 + n;
  return `${number}${DNI_LETTERS[number % 23]}`;
}

const PDF = { name: 'certificado.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') };
const PNG = {
  name: 'certificado.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
};

const run = { email: '', name: '', password: `OnWay-habil-${STAMP}-a` };

// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.beforeAll(async ({}, info) => {
  const tag = tagOf(info);
  run.email = `e2e-${tag}-${STAMP}-habil@example.org`;
  run.name = `E2E ${tag} ${STAMP} Habil`;
  await createApprovedRescuer(run.email, run.name, run.password);
});

// eslint-disable-next-line no-empty-pattern -- ídem
test.afterAll(async ({}, info) => {
  await retireE2eAccounts(`e2e-${tagOf(info)}-${STAMP}-%@example.org`);
});

/** Escribe con la sesión del navegador, con el CSRF de la sesión. */
async function api<T>(page: Page, method: 'PATCH' | 'POST', url: string, data: unknown): Promise<T | undefined> {
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as { csrfToken: string };
  const response = await page.request.fetch(`/api/v1${url}`, { method, data, headers: { 'X-CSRF-Token': me.csrfToken } });
  expect(response.status(), `${method} ${url}`).toBeLessThan(300);
  return response.status() === 204 ? undefined : ((await response.json()) as T);
}

/** El rescatista nuevo entra con el perfil incompleto; se completa por la API para llegar a Mi perfil. */
async function enter(page: Page, info: { project: { name: string } }): Promise<void> {
  await login(page, { email: run.email, password: run.password });
  const me = (await (await page.request.get('/api/v1/my/profile')).json()) as { status: string };
  if (me.status !== 'complete') {
    await api(page, 'PATCH', '/my/profile', {
      phone: '+34 600 000 901',
      document: { type: 'dni', number: dniFor(`${tagOf(info)}${STAMP}`) },
      address: { street: 'Calle Inventada de la Prueba', number: '9', postalCode: '22630', locality: 'Biescas', province: 'Huesca', country: 'ES' },
    });
  }
  await page.goto('/profile');
  await expect(heading(page, es.profile.title)).toBeVisible();
}

const section = (page: Page, name = S.title) => page.getByRole('region', { name, exact: true });
const entry = (page: Page, name: string, title = S.title) => section(page, title).getByRole('listitem').filter({ hasText: name });

test('the rescuer adds a course with a PDF certificate and a skill without one', async ({ page }, info) => {
  await enter(page, info);
  const skills = section(page);
  await expect(skills.getByText(S.empty)).toBeVisible();

  await skills.getByRole('button', { name: S.add, exact: true }).click();
  let dialog = page.getByRole('dialog', { name: S.addTitle });
  await expect(dialog.getByLabel(S.fields.name)).toBeFocused();
  await dialog.getByLabel(S.fields.name).fill(COURSE);
  await dialog.getByLabel(S.fields.issuer).fill('Entidad Ficticia de Montaña');
  await dialog.getByLabel(S.fields.issuedOn).fill('2026-03-01');
  await dialog.getByLabel(S.fields.expiresOn).fill('2028-03-01');
  await dialog.getByLabel(S.fields.certificate).setInputFiles(PDF);
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: S.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(entry(page, COURSE).getByText(S.attached)).toBeVisible();

  // Una habilidad no ofrece el archivo.
  await skills.getByRole('button', { name: S.add, exact: true }).click();
  dialog = page.getByRole('dialog', { name: S.addTitle });
  await dialog.getByLabel(S.fields.name).fill(SKILL);
  await dialog.getByLabel(S.fields.kind).selectOption('skill');
  await expect(dialog.getByLabel(S.fields.certificate)).toHaveCount(0);
  await dialog.getByRole('button', { name: S.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(entry(page, SKILL)).toBeVisible();
  await expect(entry(page, SKILL).getByRole('button', { name: S.openCertificate })).toHaveCount(0);
  await expect(entry(page, COURSE).getByText('Entidad Ficticia de Montaña')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

/** Abre el certificado del curso y devuelve el tipo que recibe la pestaña nueva. */
async function openAndReadType(page: Page, name: string): Promise<string> {
  const certificateResponse = page.context().waitForEvent('response', (response) => /\/api\/v1\/certificates\//.test(response.url()));
  const popup = page.context().waitForEvent('page');
  await entry(page, name)
    .getByRole('button', { name: S.openFor.replace('{{name}}', name) })
    .click();
  const response = await certificateResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('inline');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  await (await popup).close();
  return response.headers()['content-type']!;
}

test('opening the certificate shows the PDF in a new tab', async ({ page }, info) => {
  await enter(page, info);
  expect(await openAndReadType(page, COURSE)).toContain('application/pdf');
});

test('editing the course and swapping the certificate for an image', async ({ page }, info) => {
  await enter(page, info);
  await entry(page, COURSE)
    .getByRole('button', { name: S.editFor.replace('{{name}}', COURSE) })
    .click();
  const dialog = page.getByRole('dialog', { name: S.editTitle });
  await expect(dialog.getByText(S.certificateCurrent)).toBeVisible();
  await dialog.getByLabel(S.fields.name).fill(COURSE_EDITED);
  await dialog.getByLabel(S.fields.certificateReplace).setInputFiles(PNG);
  await dialog.getByRole('button', { name: S.save, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(entry(page, COURSE_EDITED)).toBeVisible();
  // El botón es el mismo, pero su nombre accesible lleva el nombre nuevo del curso.
  await expect(entry(page, COURSE_EDITED).getByRole('button', { name: S.editFor.replace('{{name}}', COURSE_EDITED) })).toBeFocused();
  expect(await openAndReadType(page, COURSE_EDITED)).toContain('image/png');
  await expectNoHorizontalOverflow(page);
});

test('removing the skill asks for confirmation and takes the entry away', async ({ page }, info) => {
  await enter(page, info);
  await entry(page, SKILL)
    .getByRole('button', { name: S.removeFor.replace('{{name}}', SKILL) })
    .click();
  const dialog = page.getByRole('dialog', { name: S.removeTitle.replace('{{name}}', SKILL) });
  await dialog.getByRole('button', { name: S.removeConfirm, exact: true }).click();
  await expect(entry(page, SKILL)).toHaveCount(0);
  await expect(section(page).getByText(S.removed)).toBeVisible();
  await expect(entry(page, COURSE_EDITED)).toBeVisible();
});

test('the administrator asks for the link: one certificate_opened row; the rescuer’s own openings left none (INV-26)', async ({ page, roleContext }, info) => {
  await enter(page, info);
  const mine = (await (await page.request.get('/api/v1/my/skills')).json()) as { items: { id: string; name: string }[] };
  const course = mine.items.find((item) => item.name === COURSE_EDITED)!;

  const admin = await openSession(roleContext, ACCOUNTS.admin);
  const link = await api<{ url: string; expiresAt: string }>(admin, 'POST', `/skills/${course.id}/certificate-link`, undefined);
  expect(link!.url).toMatch(/^\/api\/v1\/certificates\/[\w.~-]+$/);
  const opened = await admin.request.get(link!.url);
  expect(opened.status()).toBe(200);
  expect(opened.headers()['content-type']).toContain('image/png');

  const rows = await auditRowsAbout(run.email, 'certificate_opened');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.actor).toBe(ACCOUNTS.admin.email);
  expect(rows[0]!.entityType).toBe('skill');
  expect(Object.keys(rows[0]!.detail)).toEqual(['fileId']);
  expect(JSON.stringify(rows[0])).not.toContain('Primeros auxilios');
});

test('keyboard only and in French: add an entry, open the edit dialog and close it with Escape', async ({ page }, info) => {
  await enter(page, info);
  await page.goto('/account');
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/me') && response.request().method() === 'PATCH');
  await page.getByRole('radio', { name: es.account.languageFr }).check();
  expect((await saved).status()).toBe(200);
  await page.goto('/profile');
  const F = fr.profile.skills;
  await expect(heading(page, fr.profile.title)).toBeVisible();

  const add = section(page, F.title).getByRole('button', { name: F.add, exact: true });
  await tabTo(page, add);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: F.addTitle });
  await expect(dialog.getByLabel(F.fields.name)).toBeFocused();
  await page.keyboard.type('Manejo de dron');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(entry(page, 'Manejo de dron', F.title)).toBeVisible();
  await expect(entry(page, 'Manejo de dron', F.title).getByRole('button', { name: F.attachFor.replace('{{name}}', 'Manejo de dron') })).toBeVisible();

  const edit = entry(page, COURSE_EDITED, F.title).getByRole('button', { name: F.editFor.replace('{{name}}', COURSE_EDITED) });
  await tabTo(page, edit);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: F.editTitle })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expectNoHorizontalOverflow(page);
});
