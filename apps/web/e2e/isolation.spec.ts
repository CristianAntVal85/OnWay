// Demostración de H0, parte 4: un usuario de otra organización no ve nada de la primera (INV-01, doc 07 §3).
// La organización B no está en la demostración: la crea `global-setup.ts` para esta ejecución (D-H0-18).
import { expect, test } from '@playwright/test';
import { ACCOUNTS, es, login } from './support/app';
import { ORG_A_NAME, ORG_A_STRINGS, ORG_B, demo } from './support/stack';

interface OrgInfo {
  name: string;
  country: string;
  inviteCode?: string;
}

const B = { email: ORG_B.adminEmail, password: ORG_B.password };

test('the administrator of organization B only sees organization B', async ({ page }) => {
  await login(page, B);
  await expect(page).toHaveURL(/\/home$/);

  // Interfaz: la cabecera y el inicio muestran B; nada de A en ninguna vista de su barra.
  await expect(page.locator('.org-name')).toHaveText(ORG_B.name);
  await expect(page.getByRole('main').getByText(ORG_B.name)).toBeVisible();
  for (const path of ['/home', '/missions', '/teams', '/routes', '/admin', '/account']) {
    await page.goto(path);
    await expect(page.locator('.org-name')).toHaveText(ORG_B.name);
    const text = await page.locator('body').innerText();
    for (const secret of ORG_A_STRINGS) expect(text, `${path} muestra «${secret}» de la organización A`).not.toContain(secret);
  }

  // API con la sesión de B: getMe y getOrganization solo traen B.
  const me = await page.request.get('/api/v1/auth/me');
  expect(me.status()).toBe(200);
  const meBody = JSON.stringify(await me.json());
  expect(meBody).toContain(ORG_B.name);
  for (const secret of ORG_A_STRINGS) expect(meBody).not.toContain(secret);

  const org = await page.request.get('/api/v1/org');
  expect(org.status()).toBe(200);
  const info = (await org.json()) as OrgInfo;
  expect(info.name).toBe(ORG_B.name);
  expect(info.country).toBe(ORG_B.country);
  expect(JSON.stringify(info)).not.toContain(ORG_A_NAME);
  // Nunca se entrega el código de invitación (doc 06).
  expect(info).not.toHaveProperty('inviteCode');
  expect(JSON.stringify(info)).not.toMatch(/E2E-[0-9a-f]{16}/);
});

test('the administrator of organization A sees A and nothing of B', async ({ page }) => {
  await login(page, ACCOUNTS.admin);
  await expect(page.locator('.org-name')).toHaveText(ORG_A_NAME);
  const info = (await (await page.request.get('/api/v1/org')).json()) as OrgInfo;
  expect(info.name).toBe(ORG_A_NAME);
  expect(info.name).not.toBe(ORG_B.name);
  await page.goto('/home');
  expect(await page.locator('body').innerText()).not.toContain(ORG_B.name);
  expect(await page.locator('body').innerText()).not.toContain(ORG_B.adminName);
  // La demostración sigue siendo de una sola organización (D-H0-18): los nombres de la demo son los de A.
  expect(demo.organization.name).toBe(ORG_A_NAME);
});

test('the session of B cannot use the cookie of A and vice versa (two sessions stay separate)', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  await login(pageA, ACCOUNTS.admin);
  await login(pageB, B);
  await expect(pageA.locator('.org-name')).toHaveText(ORG_A_NAME);
  await expect(pageB.locator('.org-name')).toHaveText(ORG_B.name);
  expect(((await (await pageA.request.get('/api/v1/org')).json()) as OrgInfo).name).toBe(ORG_A_NAME);
  expect(((await (await pageB.request.get('/api/v1/org')).json()) as OrgInfo).name).toBe(ORG_B.name);
  // Cada una es administrador de lo suyo.
  await pageB.goto('/admin');
  await expect(pageB.getByRole('heading', { level: 1, name: es.nav.administration })).toBeVisible();
  await a.close();
  await b.close();
});
