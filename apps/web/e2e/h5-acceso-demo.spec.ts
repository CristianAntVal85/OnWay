// Demostración de `H5-acceso` (doc 07 §3, plan §6) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px, con el
// correo del adaptador de consola del `api` (el «correo» es una línea de su registro: `support/stack.ts`). Todo es ficticio. Dos historias:
//   1. Alta y aprobación. Una persona nueva pulsa «Crear una cuenta» en el login y se registra con el código que el administrador ve en
//      Administración (y que es el de la base); un correo ya registrado da el MISMO fallo que un código inválido; lee «Solicitud recibida»,
//      entra y ve la espera. El administrador (otro contexto) la ve en la bandeja y la aprueba como rescatista (elige el rol a propósito);
//      ella vuelve a entrar y llega a «Completa tu perfil», sin Administración. Después el administrador REGENERA el código: el viejo ya no
//      registra (solo con teclado y en francés), el nuevo sí, y la segunda persona es rechazada desde la bandeja y no accede (INV-25).
//   2. Recuperar la contraseña. «He olvidado mi contraseña» -> el enlace sale del registro del `api` -> el token viaja en el fragmento y se
//      quita de la barra -> nueva contraseña -> entra con ella, la antigua ya no sirve, las sesiones abiertas se cierran y el mismo enlace
//      reutilizado da «Enlace no válido». Otra vez, solo con teclado y en francés.
// Las cuentas se llaman «E2E …» y su correo es `e2e-…@example.org`. No se pueden borrar (la auditoría es de solo añadir): al terminar, las
// pendientes quedan RECHAZADAS y las aprobadas DESACTIVADAS (`retireE2eAccounts`; también en el `globalSetup` por si se interrumpe una ejecución).
//
// El código de invitación es de TODA la organización: regenerarlo en un proyecto rompería el registro del otro si corrieran a la vez. Por
// eso el móvil de esta demostración es el proyecto `mobile-access`, que espera a que termine el de escritorio (playwright.config.ts).
// Peticiones a los endpoints públicos por proyecto (límites del `api` por IP: registro 10/10 min, recuperar 5/h, restablecer 10/h; el
// `globalSetup` reinicia el `api` y vacía los contadores): registro 4, recuperar 2, restablecer 3. Dos proyectos: 8, 4 y 6.
import type { Locator, Page } from '@playwright/test';
import { ACCOUNTS, fr } from './support/app';
import { es, expect, expectNoHorizontalOverflow, openSession, tabTo, test } from './support/demo';
import { currentInviteCode, lastPasswordResetMail, retireE2eAccounts } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);
const S = es.admin.signups;
const I = es.admin.inviteCode;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

// Solo lo de esta ejecución y de este formato (su sello y su etiqueta): con dos trabajadores, el otro formato puede tener sus cuentas a la vez.
// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.afterAll(async ({}, info) => {
  await retireE2eAccounts(`e2e-${tagOf(info)}-${STAMP}-%@example.org`);
});

const tagOf = (info: { project: { name: string } }) => (info.project.name === 'desktop' ? 'd' : 'm');
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key]));

interface Person {
  email: string;
  name: string;
  password: string;
}
const run = {
  code: '',
  newCode: '',
  ana: { email: '', name: '', password: 'OnWay-ficticia-ana-2026' } as Person,
  beatrice: { email: '', name: '', password: 'OnWay-ficticia-bea-2026' } as Person,
  failure: null as null | { status: number; error: { code: string; message: string } },
  newPassword: `OnWay-nueva-${STAMP}-es`,
  newPasswordFr: `OnWay-nouveau-${STAMP}-fr`,
};
// eslint-disable-next-line no-empty-pattern -- Playwright exige desestructurar el primer argumento aunque no se use ninguno
test.beforeAll(async ({}, info) => {
  const tag = tagOf(info);
  run.ana = { ...run.ana, email: `e2e-${tag}-${STAMP}-ana@example.org`, name: `E2E ${tag} ${STAMP} Ana` };
  run.beatrice = { ...run.beatrice, email: `e2e-${tag}-${STAMP}-bea@example.org`, name: `E2E ${tag} ${STAMP} Beatrice` };
});

const isRegister = (response: { url(): string; request(): { method(): string } }) => response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST';

/** Lo que el servidor contestó sin lo propio de cada petición (`requestId`): para comparar dos fallos. */
async function failureOf(response: Awaited<ReturnType<Page['waitForResponse']>>) {
  const body = (await response.json()) as { error: { code: string; message: string; requestId?: string } };
  return { status: response.status(), error: { code: body.error.code, message: body.error.message } };
}

/** El código de invitación que ve el administrador en Administración (en un contexto aparte, como lo haría de verdad). */
async function readInviteCode(admin: Page): Promise<string> {
  await admin.goto('/admin');
  const section = admin.getByRole('region', { name: I.title, exact: true });
  const code = section.locator('code');
  await expect(code).toBeVisible();
  return (await code.innerText()).trim();
}

/** La bandeja del administrador, filtrada por el correo de la persona (la cuenta pendiente de la semilla no entra en la búsqueda). */
async function searchInbox(admin: Page, email: string, tab: 'pending' | 'approved' | 'rejected' = 'pending'): Promise<Locator> {
  await admin.goto(`/admin?tab=${tab}`);
  const inbox = admin.getByRole('region', { name: S.title, exact: true });
  await inbox.getByLabel(S.searchLabel).fill(email);
  await inbox.getByRole('button', { name: S.searchSubmit, exact: true }).click();
  // Hasta que la lista es la filtrada: una sola solicitud, la de esa persona.
  await expect(inbox.getByText(fill(S.summary, { total: 1 }), { exact: true })).toBeVisible();
  await expect(inbox.getByText(email, { exact: true })).toBeVisible();
  // Solo esa persona: la búsqueda no deja pasar a nadie más (en particular, no a pendiente@example.org).
  await expect(inbox.getByRole('listitem').filter({ hasText: ACCOUNTS.pending.email })).toHaveCount(0);
  return inbox;
}

/** Aprueba (con el rol elegido) o rechaza a la persona seleccionada, con la confirmación del diálogo. */
async function decide(admin: Page, inbox: Locator, person: Person, action: 'approve' | 'reject'): Promise<void> {
  await inbox.getByRole('checkbox', { name: person.name }).check();
  await expect(inbox.getByText(fill(S.selectionCount, { count: 1 }), { exact: true }).first()).toBeVisible();
  await inbox.getByRole('button', { name: action === 'approve' ? S.approve : S.reject, exact: true }).click();
  const T = action === 'approve' ? S.approveDialog : S.rejectDialog;
  const dialog = admin.getByRole('dialog', { name: T.title });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(person.name, { exact: true })).toBeVisible();
  if (action === 'approve') {
    // El rol no viene marcado: sin elegirlo, no se aprueba.
    await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: T.confirm }).click();
    await expect(dialog.getByText(S.approveDialog.roleRequired)).toBeVisible();
    await dialog.getByRole('radio', { name: new RegExp(`^${es.account.roleRescuer}`) }).check();
    await expect(dialog.getByText(fill(S.approveDialog.summary, { role: es.account.roleRescuer }))).toBeVisible();
  }
  await dialog.getByRole('button', { name: T.confirm }).click();
  await expect(dialog).toBeHidden();
}

/** Escribe con el teclado: llega al campo con Tab y escribe (al llegar con Tab el campo queda seleccionado: lo escrito lo sustituye). */
async function typeInto(page: Page, field: Locator, text: string): Promise<void> {
  await tabTo(page, field);
  await page.keyboard.type(text);
}

/** Elige el francés en el selector de idioma del acceso solo con el teclado: Tab hasta el grupo y flecha a la derecha. */
async function chooseFrenchByKeyboard(page: Page): Promise<void> {
  await tabTo(page, page.getByLabel(es.account.languageEs));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel(fr.account.languageFr)).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
}

async function loginByKeyboardFr(page: Page, who: { email: string; password: string }): Promise<void> {
  await typeInto(page, page.getByLabel(fr.login.email, { exact: true }), who.email);
  await typeInto(page, page.getByLabel(fr.login.password, { exact: true }), who.password);
  await page.keyboard.press('Enter');
}

test('the administrator sees the invite code, and it is the real one', async ({ roleContext }) => {
  const admin = await openSession(roleContext, ACCOUNTS.admin);
  run.code = await readInviteCode(admin);
  expect(run.code.length).toBeGreaterThanOrEqual(10);
  expect(run.code, 'lo que ve el administrador es lo que hay en la base').toBe(await currentInviteCode());
  await expectNoHorizontalOverflow(admin);
});

test('a new person signs up from the login with the invite code and waits for approval', async ({ page }) => {
  // El login ofrece los dos caminos; «Crear una cuenta» lleva al registro.
  await page.goto('/login');
  await expect(page.getByRole('link', { name: es.login.forgotPassword })).toBeVisible();
  await page.getByRole('link', { name: es.login.createAccount }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { level: 1, name: es.register.title })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Sin escribir nada, se avisa antes de preguntar al servidor.
  await page.getByRole('button', { name: es.register.submit }).click();
  await expect(page.getByText(es.fieldError.email.required)).toBeVisible();
  await expect(page.getByText(es.fieldError.inviteCode.required)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Un correo ya registrado (el del administrador) con el código bueno: el fallo único, sin decir qué falló.
  const fillForm = async (email: string, name: string, password: string, code: string) => {
    await page.getByLabel(es.register.email, { exact: true }).fill(email);
    await page.getByLabel(es.register.displayName, { exact: true }).fill(name);
    await page.getByLabel(es.register.password, { exact: true }).fill(password);
    await page.getByLabel(es.register.passwordConfirm, { exact: true }).fill(password);
    await page.getByLabel(es.register.inviteCode, { exact: true }).fill(code);
  };
  await fillForm(ACCOUNTS.admin.email, run.ana.name, run.ana.password, run.code);
  const taken = page.waitForResponse(isRegister);
  await page.getByRole('button', { name: es.register.submit }).click();
  run.failure = await failureOf(await taken);
  expect(run.failure.status).toBe(422);
  expect(run.failure.error.code).toBe('REGISTRATION_FAILED');
  await expect(page.getByRole('alert')).toContainText(es.register.failed);
  await expect(page.getByRole('alert')).not.toContainText(ACCOUNTS.admin.email);

  // Con su correo y el código del administrador: «Solicitud recibida», sin sesión ni rol (RN-25).
  await page.getByLabel(es.register.email, { exact: true }).fill(run.ana.email);
  const accepted = page.waitForResponse(isRegister);
  await page.getByRole('button', { name: es.register.submit }).click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  expect(JSON.stringify(await response.json())).not.toMatch(/role|session|csrf/i);
  await expect(page.getByRole('heading', { level: 1, name: es.register.receivedTitle })).toBeFocused();
  await expect(page.getByText(es.register.receivedBody)).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Puede entrar, pero solo ve la espera.
  await page.getByRole('link', { name: es.register.toLogin }).click();
  await page.getByLabel(es.login.email).fill(run.ana.email);
  await page.getByLabel(es.login.password).fill(run.ana.password);
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page).toHaveURL(/\/waiting$/);
  await expect(page.getByRole('heading', { level: 1, name: es.waiting.title })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect((await page.request.get('/api/v1/org')).status()).toBe(403);
});

test('the administrator finds the request in the inbox and approves it as a rescuer', async ({ roleContext, page }) => {
  const admin = await openSession(roleContext, ACCOUNTS.admin);
  const inbox = await searchInbox(admin, run.ana.email);
  await expect(inbox.getByText(run.ana.name, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(admin);
  // Usable también a 375 px: la fila cabe, y las acciones son objetivos táctiles de 44 px o más.
  await inbox.getByRole('checkbox', { name: run.ana.name }).check();
  for (const label of [S.approve, S.reject]) {
    const button = inbox.getByRole('button', { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const box = (await button.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual((admin.viewportSize()?.width ?? 0) + 0.5);
  }
  await inbox.getByRole('checkbox', { name: run.ana.name }).uncheck();
  await expect(inbox.getByText(S.selectionHint)).toBeVisible();

  await decide(admin, inbox, run.ana, 'approve');
  await expect(admin.getByText(fill(S.approved, { role: es.account.roleRescuer.toLowerCase(), count: 1 }))).toBeVisible();
  await expectNoHorizontalOverflow(admin);
  // Ya no está pendiente; aparece en «Aprobadas».
  await expect(inbox.getByText(run.ana.email, { exact: true })).toHaveCount(0);
  const approved = await searchInbox(admin, run.ana.email, 'approved');
  await expect(approved.getByText(S.status.approved, { exact: true })).toBeVisible();
  // La cuenta de la semilla sigue pendiente.
  await admin.goto('/admin?tab=pending');
  await expect(admin.getByText(ACCOUNTS.pending.email, { exact: true })).toBeVisible();

  // Ella vuelve a entrar y llega a «Completa tu perfil»: ya no está en la espera. No ve Administración, y el servidor tampoco se la da.
  await page.goto('/login');
  await page.getByLabel(es.login.email).fill(run.ana.email);
  await page.getByLabel(es.login.password).fill(run.ana.password);
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: es.profile.completeTitle })).toBeVisible();
  const menu = page.getByRole('button', { name: es.nav.menu, exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole('navigation', { name: es.nav.label }).getByRole('link', { name: es.nav.administration })).toHaveCount(0);
  expect((await page.request.get('/api/v1/admin/signup-requests')).status()).toBe(403);
  await expectNoHorizontalOverflow(page);
});

test('recovering the password: the link comes by mail, works once, and closes the other sessions', async ({ page, roleContext }) => {
  // Una sesión abierta de Ana en otro contexto: restablecer la contraseña la cierra.
  const other = await openSession(roleContext, { email: run.ana.email, password: run.ana.password });
  await expect(other).toHaveURL(/\/profile$/);

  await page.goto('/login');
  await page.getByRole('link', { name: es.login.forgotPassword }).click();
  await expect(page.getByRole('heading', { level: 1, name: es.recovery.forgotTitle })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel(es.recovery.email).fill(run.ana.email);
  const since = new Date();
  await page.getByRole('button', { name: es.recovery.forgotSubmit }).click();
  await expect(page.getByText(es.recovery.forgotSent)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: es.recovery.forgotTitle })).toBeFocused();
  await expectNoHorizontalOverflow(page);

  // El «correo»: el enlace sale del registro del `api`, con el token en el fragmento (no viaja al servidor).
  const mail = await lastPasswordResetMail(run.ana.email, { since });
  expect(mail.locale).toBe('es');
  const link = new URL(mail.link);
  expect(link.pathname).toBe('/reset-password');
  expect(link.search).toBe('');
  expect(mail.token.length).toBeGreaterThanOrEqual(20);
  const target = `${link.pathname}${link.hash}`;

  await page.goto(target);
  await expect(page.getByRole('heading', { level: 1, name: es.recovery.resetTitle })).toBeVisible();
  // El fragmento con el token se quita de la barra de direcciones y no queda en el historial.
  await expect(page).toHaveURL((url) => url.pathname === '/reset-password' && url.hash === '');
  expect(await page.evaluate(() => `${location.hash}|${document.referrer}`)).not.toContain(mail.token);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(mail.token);
  await expectNoHorizontalOverflow(page);

  // Contraseñas distintas: se avisa sin gastar el enlace. Luego, la buena.
  await page.getByLabel(es.recovery.newPassword, { exact: true }).fill(run.newPassword);
  await page.getByLabel(es.recovery.newPasswordConfirm, { exact: true }).fill(`${run.newPassword}-otra`);
  await page.getByRole('button', { name: es.recovery.resetSubmit }).click();
  await expect(page.getByText(es.fieldError.passwordConfirm.mismatch)).toBeVisible();
  await page.getByLabel(es.recovery.newPasswordConfirm, { exact: true }).fill(run.newPassword);
  await page.getByRole('button', { name: es.recovery.resetSubmit }).click();
  await expect(page.getByRole('heading', { level: 1, name: es.recovery.resetDoneTitle })).toBeFocused();
  await expectNoHorizontalOverflow(page);

  // La contraseña antigua ya no sirve; la nueva, sí.
  await page.getByRole('link', { name: es.recovery.toLogin }).click();
  await page.getByLabel(es.login.email).fill(run.ana.email);
  await page.getByLabel(es.login.password).fill(run.ana.password);
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page.getByRole('alert')).toContainText(es.errors.INVALID_CREDENTIALS);
  await page.getByLabel(es.login.password).fill(run.newPassword);
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: es.profile.completeTitle })).toBeVisible();

  // La sesión que estaba abierta se cerró al restablecer.
  await other.reload();
  await expect(other).toHaveURL(/\/login/);

  // El mismo enlace, otra vez y desde otro navegador: «Enlace no válido» (no dice si estaba usado o caducado).
  const stranger = await (await roleContext()).newPage();
  await stranger.goto(target);
  await stranger.getByLabel(es.recovery.newPassword, { exact: true }).fill(`${run.newPassword}-2`);
  await stranger.getByLabel(es.recovery.newPasswordConfirm, { exact: true }).fill(`${run.newPassword}-2`);
  await stranger.getByRole('button', { name: es.recovery.resetSubmit }).click();
  await expect(stranger.getByRole('heading', { level: 1, name: es.recovery.invalidLinkTitle })).toBeFocused();
  await expect(stranger.getByRole('alert')).toContainText(es.errors.INVALID_RESET_TOKEN);
  await expect(stranger).toHaveURL((url) => url.hash === '');
  await expectNoHorizontalOverflow(stranger);
  // Y la contraseña buena sigue siendo la nueva (el enlace gastado no la cambió).
  const check = await openSession(roleContext, { email: run.ana.email, password: run.newPassword });
  await expect(check).toHaveURL(/\/profile$/);
});

test('regenerating the invite code: the old one no longer registers (French, keyboard only), the new one does', async ({ page, roleContext }) => {
  const admin = await openSession(roleContext, ACCOUNTS.admin);
  expect(await readInviteCode(admin)).toBe(run.code);
  const section = admin.getByRole('region', { name: I.title, exact: true });
  await section.getByRole('button', { name: I.rotate, exact: true }).click();
  const dialog = admin.getByRole('dialog', { name: I.rotateTitle });
  await expect(dialog.getByRole('button', { name: I.rotateCancel })).toBeFocused(); // el foco empieza en la opción segura
  await dialog.getByRole('button', { name: I.rotateConfirm }).click();
  await expect(admin.getByText(I.rotated)).toBeVisible();
  run.newCode = (await section.locator('code').innerText()).trim();
  expect(run.newCode).not.toBe(run.code);
  expect(run.newCode, 'lo que ve el administrador es lo que hay en la base').toBe(await currentInviteCode());
  await expectNoHorizontalOverflow(admin);

  // Francés y solo con teclado: del login al registro con el código VIEJO.
  await page.goto('/login');
  await chooseFrenchByKeyboard(page);
  await tabTo(page, page.getByRole('link', { name: fr.login.createAccount }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: fr.register.title })).toBeVisible();
  await typeInto(page, page.getByLabel(fr.register.email, { exact: true }), run.beatrice.email);
  await typeInto(page, page.getByLabel(fr.register.displayName, { exact: true }), run.beatrice.name);
  await typeInto(page, page.getByLabel(fr.register.password, { exact: true }), run.beatrice.password);
  await typeInto(page, page.getByLabel(fr.register.passwordConfirm, { exact: true }), run.beatrice.password);
  await typeInto(page, page.getByLabel(fr.register.inviteCode, { exact: true }), run.code);
  const old = page.waitForResponse(isRegister);
  await page.keyboard.press('Enter');
  const oldFailure = await failureOf(await old);
  // El mismo fallo, cuerpo y estado, que con un correo ya registrado: no se puede saber cuál de las dos cosas fue.
  expect(oldFailure).toEqual(run.failure);
  await expect(page.getByRole('alert')).toContainText(fr.register.failed);
  await expectNoHorizontalOverflow(page);

  // Con el código nuevo (sustituye al escrito) y el botón con teclado: «Demande reçue».
  await typeInto(page, page.getByLabel(fr.register.inviteCode, { exact: true }), run.newCode);
  const accepted = page.waitForResponse(isRegister);
  await tabTo(page, page.getByRole('button', { name: fr.register.submit }));
  await page.keyboard.press('Enter');
  expect((await accepted).status()).toBe(202);
  await expect(page.getByRole('heading', { level: 1, name: fr.register.receivedTitle })).toBeFocused();
  await expect(page.getByText(fr.register.receivedBody)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // El administrador la rechaza desde la bandeja; su cuenta queda sin acceso (INV-25).
  const inbox = await searchInbox(admin, run.beatrice.email);
  await decide(admin, inbox, run.beatrice, 'reject');
  await expect(admin.getByText(fill(S.rejected, { count: 1 }))).toBeVisible();
  const rejected = await searchInbox(admin, run.beatrice.email, 'rejected');
  await expect(rejected.getByText(S.status.rejected, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(admin);
  await page.goto('/login'); // el idioma elegido se conserva
  await loginByKeyboardFr(page, run.beatrice);
  await expect(page.getByRole('alert')).toContainText(fr.errors.ACCOUNT_REJECTED);
  await expect(page).toHaveURL(/\/login$/);
});

test('recovering the password in French with the keyboard only', async ({ page }) => {
  await page.goto('/login');
  await chooseFrenchByKeyboard(page);
  await tabTo(page, page.getByRole('link', { name: fr.login.forgotPassword }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: fr.recovery.forgotTitle })).toBeVisible();
  await typeInto(page, page.getByLabel(fr.recovery.email, { exact: true }), run.ana.email);
  const since = new Date();
  await page.keyboard.press('Enter');
  await expect(page.getByText(fr.recovery.forgotSent)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // El correo sale en el idioma de la CUENTA (es, el del registro de Ana); la pantalla del enlace sigue en el del navegador (fr).
  const mail = await lastPasswordResetMail(run.ana.email, { since });
  expect(mail.locale).toBe('es');
  const link = new URL(mail.link);
  await page.goto(`${link.pathname}${link.hash}`);
  await expect(page.getByRole('heading', { level: 1, name: fr.recovery.resetTitle })).toBeVisible();
  await expect(page).toHaveURL((url) => url.hash === '');
  await typeInto(page, page.getByLabel(fr.recovery.newPassword, { exact: true }), run.newPasswordFr);
  await typeInto(page, page.getByLabel(fr.recovery.newPasswordConfirm, { exact: true }), run.newPasswordFr);
  await tabTo(page, page.getByRole('button', { name: fr.recovery.resetSubmit }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: fr.recovery.resetDoneTitle })).toBeFocused();
  await expectNoHorizontalOverflow(page);

  // Entra con la contraseña nueva, también con el teclado, y llega a su perfil.
  await tabTo(page, page.getByRole('link', { name: fr.recovery.toLogin }));
  await page.keyboard.press('Enter');
  await loginByKeyboardFr(page, { email: run.ana.email, password: run.newPasswordFr });
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { level: 1, name: fr.profile.completeTitle })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
