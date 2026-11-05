// Demostración de H0, parte 3: credenciales erróneas, idioma y teclado (RF-101, RF-701/702, criterio 8 del doc 07 §4).
import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, es, fr, heading, login } from './support/app';

interface LoginOutcome {
  status: number;
  code: string;
  message: string;
  shown: string;
}

async function failedLogin(page: Page, email: string, password: string): Promise<LoginOutcome> {
  await page.goto('/login');
  await page.getByLabel(es.login.email).fill(email);
  await page.getByLabel(es.login.password).fill(password);
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: es.login.submit }).click();
  const answer = await response;
  const body = (await answer.json()) as { error: { code: string; message: string } };
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(es.errors.INVALID_CREDENTIALS);
  return { status: answer.status(), code: body.error.code, message: body.error.message, shown: (await alert.innerText()).trim() };
}

test('wrong credentials give the same generic message whether or not the account exists (RF-101)', async ({ browser }) => {
  const outcomes: LoginOutcome[] = [];
  for (const email of [ACCOUNTS.rescuer.email, 'no-existe-nadie@example.org']) {
    const context = await browser.newContext();
    outcomes.push(await failedLogin(await context.newPage(), email, 'contraseña-incorrecta-1'));
    await context.close();
  }
  const [existing, unknown] = outcomes;
  expect(existing!.status).toBe(401);
  expect(existing!.code).toBe('INVALID_CREDENTIALS');
  expect(unknown).toEqual(existing);
  expect(existing!.shown).toBe(es.errors.INVALID_CREDENTIALS);
  // No se delata nada de la cuenta en el mensaje.
  expect(existing!.shown).not.toContain(ACCOUNTS.rescuer.email);

  // Un fallo aislado no bloquea la cuenta (el bloqueo llega a los 5): sigue entrando con la contraseña buena.
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, ACCOUNTS.rescuer);
  await expect(page.getByRole('navigation', { name: es.nav.label })).toBeVisible();
  await context.close();
});

test('empty fields are reported before asking the server', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page.getByText(es.login.emailRequired)).toBeVisible();
  await page.getByLabel(es.login.email).fill(ACCOUNTS.admin.email);
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page.getByText(es.login.passwordRequired)).toBeVisible();
});

test('switching to French translates the interface, survives the login and a reload', async ({ page }) => {
  await page.goto('/login');
  await expect(heading(page, es.login.title)).toBeVisible();
  await page.getByLabel(es.account.languageFr).check();
  await expect(heading(page, fr.login.title)).toBeVisible();
  await expect(page.getByLabel(fr.login.email)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  // En francés también los errores salen de packages/i18n.
  await page.getByLabel(fr.login.email).fill('no-existe-nadie@example.org');
  await page.getByLabel(fr.login.password).fill('contraseña-incorrecta-1');
  await page.getByRole('button', { name: fr.login.submit }).click();
  await expect(page.getByRole('alert')).toContainText(fr.errors.INVALID_CREDENTIALS);

  await page.getByLabel(fr.login.email).fill(ACCOUNTS.coordinatorFr.email);
  await page.getByLabel(fr.login.password).fill(ACCOUNTS.coordinatorFr.password);
  await page.getByRole('button', { name: fr.login.submit }).click();
  const nav = page.getByRole('navigation', { name: fr.nav.label });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveText([fr.nav.home, fr.nav.missions, fr.nav.createMission, fr.nav.routes, fr.nav.teams, fr.nav.account]);

  await page.reload();
  await expect(page.getByRole('navigation', { name: fr.nav.label })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  // Y de vuelta al español desde Cuenta.
  await page.getByRole('link', { name: fr.nav.account }).click();
  await page.getByLabel(fr.account.languageEs).check();
  await expect(heading(page, es.account.title)).toBeVisible();
});

test('the whole access (log in, move around, switch language, log out) works with the keyboard only', async ({ page }) => {
  const key = (name: string) => page.keyboard.press(name);
  await page.goto('/login');

  // Orden de tabulación: saltar al contenido -> correo -> contraseña -> entrar.
  await key('Tab');
  await expect(page.getByRole('link', { name: es.nav.skipToContent })).toBeFocused();
  await key('Tab');
  await expect(page.getByLabel(es.login.email)).toBeFocused();
  await page.keyboard.type(ACCOUNTS.coordinator.email);
  await key('Tab');
  await expect(page.getByLabel(es.login.password)).toBeFocused();
  await page.keyboard.type(ACCOUNTS.coordinator.password);
  await key('Tab');
  await expect(page.getByRole('button', { name: es.login.submit })).toBeFocused();
  await key('Enter');

  // Tras entrar, el foco pasa al contenido; el foco visible no se pierde.
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('main')).toBeFocused();

  // Navegar a Equipos con la barra: tabulación hasta el enlace y Enter. El inicio lleva misiones activas (en H1, también las de otras
  // pruebas en marcha) y la barra queda antes del contenido: hay que dar la vuelta, así que el tope de pulsaciones es generoso.
  const teams = page.getByRole('navigation', { name: es.nav.label }).getByRole('link', { name: es.nav.teams });
  for (let i = 0; i < 60 && !(await teams.evaluate((el) => el === document.activeElement)); i += 1) await key('Tab');
  await expect(teams).toBeFocused();
  await key('Enter');
  await expect(page).toHaveURL(/\/teams$/);
  await expect(heading(page, es.nav.teams)).toBeVisible();

  // Cuenta: cambiar idioma con las flechas del grupo de opciones y cerrar sesión con Enter.
  await page.goto('/account');
  await page.getByLabel(es.account.languageEs).focus();
  await key('ArrowRight');
  await expect(heading(page, fr.account.title)).toBeVisible();
  await key('ArrowLeft');
  await expect(heading(page, es.account.title)).toBeVisible();
  await page.getByRole('button', { name: es.account.logout }).focus();
  await key('Enter');
  await expect(page).toHaveURL(/\/login$/);
});

test('the login links reach the public sign up and password views with the keyboard, in both languages (H5-acceso)', async ({ page }) => {
  const key = (name: string) => page.keyboard.press(name);
  await page.goto('/login');
  await page.getByRole('button', { name: es.login.submit }).focus();
  await key('Tab');
  await expect(page.getByRole('link', { name: es.login.forgotPassword })).toBeFocused();
  await key('Tab');
  await expect(page.getByRole('link', { name: es.login.createAccount })).toBeFocused();
  await key('Enter');
  await expect(page).toHaveURL(/\/register$/);
  await expect(heading(page, es.register.title)).toBeVisible();

  // Sin sesión las tres vistas se abren (la guarda de rutas no las lleva al acceso) y vuelven al acceso con su enlace.
  await page.getByRole('link', { name: es.register.haveAccount }).click();
  await expect(heading(page, es.login.title)).toBeVisible();
  await page.getByRole('link', { name: es.login.forgotPassword }).click();
  await expect(heading(page, es.recovery.forgotTitle)).toBeVisible();
  await page.getByLabel(es.account.languageFr).check();
  await expect(heading(page, fr.recovery.forgotTitle)).toBeVisible();

  // Un enlace de recuperación sin token (o con él en la query, no en el fragmento) da el mensaje único y ofrece pedir otro.
  await page.goto('/reset-password?token=no-vale');
  await expect(heading(page, fr.recovery.invalidLinkTitle)).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(fr.errors.INVALID_RESET_TOKEN);
  await expect(page.getByRole('link', { name: fr.recovery.requestAnother })).toBeVisible();
});
