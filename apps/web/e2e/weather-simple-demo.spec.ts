// Demostración de la issue #18 (tarjeta del tiempo simple) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// Inicio enseña tres iconos por tramo del día con su horario (el tramo en curso primero), el termómetro con la temperatura y el viento, y la tarjeta
// mide como mucho el 55 % de la anterior (770 px → 423 px, `specs/issue-18-tiempo-simple/medidas.md`); nada técnico ni luz y luna. Un botón lleva a la
// vista de detalle, que lo trae todo (y la luz y la luna) y vuelve. El rescatista la ve en Mis misiones y vuelve a Misiones. En francés y solo con
// teclado. Todo es ficticio y la demostración solo lee la semilla: no crea ni retira nada.
import { ACCOUNTS, fr } from './support/app';
import { DEVICE_AT, es, expect, expectNoHorizontalOverflow, login, openSession, tabTo, test } from './support/demo';

const E = es.environment;
/** Altura de la tarjeta del tiempo antes del cambio (medida el 2026-11-13) y el umbral del 55 % que decidió el usuario. */
const OLD_HEIGHT_PX = 770;
const MAX_HEIGHT_PX = Math.floor(OLD_HEIGHT_PX * 0.55);

test.use({ geolocation: { latitude: DEVICE_AT.latitude, longitude: DEVICE_AT.longitude }, permissions: ['geolocation'] });

test('home shows three day parts, the temperature and the wind in a card at most 55 % of the old height, and nothing technical', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await expect(page).toHaveURL(/\/home$/);
  const section = page.getByRole('region', { name: E.title, exact: true });
  const card = section.getByRole('region', { name: E.weather.title, exact: true });
  await expect(card).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });

  // Tres tramos con su horario; el primero es el tramo en curso del reloj del navegador.
  const parts = card.getByRole('list', { name: E.simple.partsLabel }).getByRole('listitem');
  await expect(parts).toHaveCount(3);
  const hour = await page.evaluate(() => new Date().getHours());
  const first = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'night';
  const order = ['morning', 'afternoon', 'night'];
  const expected = [0, 1, 2].map((step) => order[(order.indexOf(first) + step) % 3]!);
  for (const [index, part] of expected.entries()) {
    const label = await parts.nth(index).locator('.visually-hidden').textContent();
    expect(label, `tramo ${index + 1}`).toMatch(new RegExp(`^${E.simple.parts[part as 'morning' | 'afternoon' | 'night']}, \\d{2}–\\d{2} h: `));
    await expect(parts.nth(index).locator('svg.wx-icon[aria-hidden="true"]')).toHaveCount(1);
  }
  await expect(parts.nth(0)).toContainText(first === 'morning' ? '06–12 h' : first === 'afternoon' ? '12–18 h' : '18–24 h');

  // Termómetro con la temperatura, viento con km/h y la cita al proveedor; nada técnico.
  await expect(card.locator('.wx-now')).toContainText(/-?\d+(,\d)? °C/);
  await expect(card.locator('.wx-now')).toContainText(/\d+ km\/h/);
  await expect(card).toContainText(E.weather.attribution);
  // («Nieve» puede salir como símbolo de un tramo, así que no se busca aquí.)
  for (const technical of [E.weather.precipitation, E.weather.cloud, E.weather.freezingLevel, E.weather.nextDays, E.weather.hourly, E.weather.now]) {
    await expect(card.getByText(technical, { exact: true })).toHaveCount(0);
  }
  await expect(card.getByText(/rachas/i)).toHaveCount(0);
  await expect(section.getByRole('region', { name: E.light.title, exact: true })).toHaveCount(0);
  await expect(section.locator('.env-place')).toHaveCount(0);

  // Ocupa menos: como mucho el 55 % de la tarjeta anterior, en este formato.
  const box = (await card.boundingBox())!;
  expect(box.height, `alto de la tarjeta (${Math.round(box.height)} px) frente al tope de ${MAX_HEIGHT_PX} px`).toBeLessThanOrEqual(MAX_HEIGHT_PX);
  await expectNoHorizontalOverflow(page);
});

test('the button opens the full detail, with the light and the moon, and comes back', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  const card = page.getByRole('region', { name: E.title, exact: true }).getByRole('region', { name: E.weather.title, exact: true });
  await expect(card).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await card.getByRole('link', { name: E.simple.detailCta }).click();

  await expect(page).toHaveURL(/\/weather$/); // la posición no viaja en la dirección (RN-26)
  await expect(page.getByRole('heading', { level: 1, name: E.detail.title })).toBeVisible();
  const detail = page.getByRole('region', { name: E.weather.title, exact: true });
  await expect(detail).toHaveAttribute('data-status', 'ok');
  for (const shown of [E.weather.temperature, E.weather.wind, E.weather.precipitation, E.weather.cloud, E.weather.freezingLevel, E.weather.nextDays]) {
    await expect(detail.getByText(shown, { exact: true }).first()).toBeVisible();
  }
  await detail.getByText(E.weather.hourly).click();
  await expect(detail.getByRole('table')).toBeVisible();
  await expect(detail).toContainText(E.weather.attribution);
  const light = page.getByRole('region', { name: E.light.title, exact: true });
  await expect(light.getByText(E.light.sunrise)).toBeVisible();
  await expect(light.getByText(/% iluminada/)).toBeVisible();
  await expect(page.locator('.env-place')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // «Tiempo en detalle» no tiene entrada en la barra, y la vuelta lleva a Inicio.
  await expect(page.getByRole('navigation').getByRole('link', { name: E.detail.title })).toHaveCount(0);
  await page.getByRole('link', { name: E.detail.backHome }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('the rescuer sees the same simple card in My missions and the detail goes back to Missions', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.rescuer, { geolocation: DEVICE_AT, permissions: ['geolocation'] });
  await page.goto('/missions');
  const card = page.getByRole('region', { name: E.title, exact: true }).getByRole('region', { name: E.weather.title, exact: true });
  await expect(card).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  await expect(card.getByRole('list', { name: E.simple.partsLabel }).getByRole('listitem')).toHaveCount(3);
  await expect(card.getByText(E.weather.freezingLevel)).toHaveCount(0);
  await card.getByRole('link', { name: E.simple.detailCta }).click();
  await expect(page.getByRole('heading', { level: 1, name: E.detail.title })).toBeVisible();
  await expect(page.getByRole('region', { name: E.light.title, exact: true })).toBeVisible();
  await page.getByRole('link', { name: E.detail.backMissions }).click();
  await expect(page).toHaveURL(/\/missions$/);
  await expectNoHorizontalOverflow(page);
});

test('in French and with the keyboard alone the card reaches the detail and comes back', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.evaluate(() => localStorage.setItem('onway.locale', 'fr'));
  await page.goto('/home');
  const F = fr.environment;
  const card = page.getByRole('region', { name: F.title, exact: true }).getByRole('region', { name: F.weather.title, exact: true });
  await expect(card).toHaveAttribute('data-status', 'ok', { timeout: 30_000 });
  const parts = card.getByRole('list', { name: F.simple.partsLabel }).getByRole('listitem');
  await expect(parts).toHaveCount(3);
  expect(await parts.first().locator('.visually-hidden').textContent()).toMatch(/^(Matin|Après-midi|Soir), \d{2}–\d{2} h : /);

  const open = card.getByRole('link', { name: F.simple.detailCta });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: F.detail.title })).toBeVisible();
  await expect(page.getByRole('region', { name: F.light.title, exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await tabTo(page, page.getByRole('link', { name: F.detail.backHome }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/home$/);
});
