// Demostración de H0, parte 1 (doc 07 §3): tres roles, tres barras distintas, y la dirección de otro rol se rechaza (RF-102, RF-103, RF-702).
import { expect, test } from '@playwright/test';
import { ACCOUNTS, es, heading, login, navLabels } from './support/app';

const { nav } = es;

test('administrator, coordinator and rescuer each see their own menu', async ({ browser }) => {
  const bars: Record<string, string[]> = {};
  for (const [role, account] of [
    ['admin', ACCOUNTS.admin],
    ['coordinator', ACCOUNTS.coordinator],
    ['rescuer', ACCOUNTS.rescuer],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, account);
    await expect(page.getByRole('navigation', { name: nav.label })).toBeVisible();
    bars[role] = await navLabels(page);
    await context.close();
  }

  // Q-14 = no: el administrador no escribe misiones, así que no tiene «Crear misión».
  expect(bars.admin).toEqual([nav.home, nav.missions, nav.routes, nav.teams, nav.administration, nav.account]);
  expect(bars.coordinator).toEqual([nav.home, nav.missions, nav.createMission, nav.routes, nav.teams, nav.account]);
  expect(bars.rescuer).toEqual([nav.missions, nav.myProfile, nav.account]);
  // Las tres barras son distintas entre sí.
  expect(new Set(Object.values(bars).map((bar) => bar.join('|'))).size).toBe(3);
});

test('each role lands on its own first screen and sees its organization and role', async ({ page }) => {
  await login(page, ACCOUNTS.admin);
  await expect(page).toHaveURL(/\/home$/);
  await expect(heading(page, es.home.title)).toBeVisible();
  await expect(page.getByRole('main').getByText(es.account.roleAdmin)).toBeVisible();
  await expect(page.getByText('Servicio de Rescate Valle Demo').first()).toBeVisible();
});

test('a rescuer who opens /admin sees "no access" and the administration link is not offered', async ({ page }) => {
  await login(page, ACCOUNTS.rescuer);
  // rescatista1 tiene el perfil completo desde H5-perfil: entra por Mis misiones (el caso incompleto es rescatista6).
  await expect(page).toHaveURL(/\/missions$/);
  expect(await navLabels(page)).not.toContain(nav.administration);

  await page.goto('/admin');
  await expect(heading(page, es.forbidden.title)).toBeVisible();
  await expect(page.getByText(es.forbidden.body)).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);

  // Lo mismo con las demás direcciones del personal.
  for (const path of ['/teams', '/routes', '/missions/new', '/home']) {
    await page.goto(path);
    await expect(heading(page, es.forbidden.title)).toBeVisible();
  }
});

test('a coordinator cannot open /admin either, but can open the staff views', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto('/admin');
  await expect(heading(page, es.forbidden.title)).toBeVisible();
  await page.goto('/teams');
  await expect(heading(page, es.nav.teams)).toBeVisible();
});

test('an anonymous visitor is sent to the login screen and returns to the requested view afterwards', async ({ page }) => {
  await page.goto('/teams');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel(es.login.email).fill(ACCOUNTS.admin.email);
  await page.getByLabel(es.login.password).fill(ACCOUNTS.admin.password);
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page).toHaveURL(/\/teams$/);
});

test('logging out ends the session: the protected views ask for the login again', async ({ page }) => {
  await login(page, ACCOUNTS.admin);
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/account');
  await page.getByRole('button', { name: es.account.logout }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login$/);
});
