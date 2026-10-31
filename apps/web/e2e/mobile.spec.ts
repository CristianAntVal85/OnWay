// Vista móvil de 375 px (proyecto `mobile`): sin desbordes horizontales y con la barra plegada tras «Menú» (criterio 8 del doc 07 §4).
import { expect, test } from '@playwright/test';
import { ACCOUNTS, es, expectNoHorizontalOverflow, login, navLabels, openMenuIfCollapsed, stubMapTiles } from './support/app';

test.beforeEach(async ({ page }) => {
  await stubMapTiles(page);
});

test('the viewport is the 375 px phone', async ({ page }) => {
  expect(page.viewportSize()?.width).toBe(375);
});

test('login screen fits the screen, also in French and with an error showing', async ({ page }) => {
  await page.goto('/login');
  await expectNoHorizontalOverflow(page);
  await page.getByLabel(es.login.email).fill('no-existe-nadie@example.org');
  await page.getByLabel(es.login.password).fill('contraseña-incorrecta-1');
  await page.getByRole('button', { name: es.login.submit }).click();
  await expect(page.getByRole('alert')).toContainText(es.errors.INVALID_CREDENTIALS);
  await expectNoHorizontalOverflow(page);
  await page.getByLabel(es.account.languageFr).check();
  await expectNoHorizontalOverflow(page);
});

for (const [role, account, paths] of [
  ['administrator', ACCOUNTS.admin, ['/home', '/missions', '/routes', '/teams', '/admin', '/account']],
  ['coordinator', ACCOUNTS.coordinator, ['/home', '/missions', '/missions/new', '/teams', '/account']],
  ['rescuer', ACCOUNTS.rescuer, ['/profile', '/missions', '/account', '/admin']],
] as const) {
  test(`${role}: every view fits the screen and the menu works by touch`, async ({ page }) => {
    await login(page, account);
    await expect(page.getByRole('main')).toBeVisible();
    // El menú está plegado hasta pulsarlo.
    await expect(page.getByRole('navigation')).toBeHidden();
    await openMenuIfCollapsed(page);
    await expect(page.getByRole('navigation')).toBeVisible();
    const labels = await navLabels(page);
    expect(labels.length).toBeGreaterThanOrEqual(3);

    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
}

test('pending account: the waiting screen fits the screen', async ({ page }) => {
  await login(page, ACCOUNTS.pending);
  await expect(page.getByRole('heading', { level: 1, name: es.waiting.title })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('navigation links are comfortable touch targets (at least 44 px high)', async ({ page }) => {
  await login(page, ACCOUNTS.admin);
  await openMenuIfCollapsed(page);
  const links = page.getByRole('navigation', { name: es.nav.label }).getByRole('link');
  const count = await links.count();
  for (let i = 0; i < count; i += 1) {
    const box = await links.nth(i).boundingBox();
    expect(box?.height ?? 0, `link ${i}`).toBeGreaterThanOrEqual(44);
  }
});
