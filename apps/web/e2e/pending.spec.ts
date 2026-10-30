// Demostración de H0, parte 2: la cuenta pendiente solo ve la espera y puede cerrar sesión (INV-25, RF-106).
import { expect, test } from '@playwright/test';
import { ACCOUNTS, es, heading, login } from './support/app';

test('a pending account sees only the waiting screen and can log out', async ({ page }) => {
  await login(page, ACCOUNTS.pending);
  await expect(page).toHaveURL(/\/waiting$/);
  await expect(heading(page, es.waiting.title)).toBeVisible();
  await expect(page.getByText(es.waiting.body)).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);

  // Ninguna otra vista: todas devuelven a la espera.
  for (const path of ['/home', '/missions', '/admin', '/account', '/profile']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/waiting$/);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  }

  // Y el servidor tampoco le da datos de la organización (403 ACCOUNT_PENDING).
  const organization = await page.request.get('/api/v1/org');
  expect(organization.status()).toBe(403);
  expect((await organization.json()).error.code).toBe('ACCOUNT_PENDING');

  await page.getByRole('button', { name: es.waiting.logout }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(heading(page, es.login.title)).toBeVisible();
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
});
