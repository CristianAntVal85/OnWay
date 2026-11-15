// Demostración del hito UI-simplificacion (plan §7) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y a 375 px.
// El coordinador cambia la capa del mapa desde el icono, ve Crear misión sin textos de ayuda, abre una ruta de la semilla, exporta su GPX
// desde «Exportar» y encuentra Duplicar y Archivar en «Más»; en el detalle de una misión, las acciones de cada ruta están en su «⋯».
// Ninguna vista del coordinador muestra más de una acción principal. Solo lee la semilla: no crea ni retira nada.
import type { Page } from '@playwright/test';
import { ACCOUNTS, chooseMapLayer, chooseMenuItem, mapLayerButton, menuItemNames } from './support/app';
import { es, expect, expectNoHorizontalOverflow, login, test } from './support/demo';

const ROUTE = 'Senda del Circo (ficticia)';

/** Botones o enlaces con aspecto de acción principal (naranja) a la vista en el contenido de la página. */
const primaryActions = (page: Page) => page.locator('main').locator('.button-primary:visible');

test('the coordinator works with fewer buttons: layers, export and more live in menus, and no help text is shown', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);

  // Inicio: una sola acción principal, «Crear misión».
  await expect(page.getByRole('heading', { level: 1, name: es.home.title })).toBeVisible();
  await expect(primaryActions(page)).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  // Rutas: una acción de cabecera («Nueva ruta ▾») y la capa del mapa desde su icono.
  await page.goto('/routes');
  expect(await menuItemNames(page, es.routes.newCta)).toEqual([es.generate.cta, es.routes.importCta, es.routes.drawCta]);
  // A 375 px la lista y el mapa son dos pestañas.
  const mapTab = page.getByRole('tab', { name: es.routes.views.map, exact: true });
  if (await mapTab.isVisible()) await mapTab.click();
  const map = page.getByRole('region', { name: es.routes.map.label });
  await expect(mapLayerButton(map)).toBeVisible({ timeout: 30_000 });
  await chooseMapLayer(map, es.map.layers.satellite);
  await expectNoHorizontalOverflow(page);

  // Crear misión: sin ayudas bajo los campos y con una sola acción principal.
  await page.goto('/missions/new');
  await expect(page.getByRole('heading', { level: 1, name: es.createMission.title })).toBeVisible();
  await expect(page.locator('.field-help')).toHaveCount(0);
  await expect(primaryActions(page)).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  // Detalle de ruta: «Editar ruta», «Exportar ▾» y «Más ⋯» en una fila; ni «Derivar» ni «Crear una versión nueva a partir de esta».
  await page.goto('/routes');
  await page.getByRole('link', { name: ROUTE, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: ROUTE })).toBeVisible();
  await expect(page.getByRole('link', { name: es.routeDetail.actions.edit, exact: true })).toBeVisible();
  await expect(page.getByText('Derivar', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Crear una versión nueva a partir de esta')).toHaveCount(0);
  expect(await menuItemNames(page, es.common.more)).toEqual([es.routeDetail.actions.duplicate, es.routeDetail.actions.archive]);
  const [download] = await Promise.all([page.waitForEvent('download'), chooseMenuItem(page, es.common.export, es.routeDetail.actions.exportGpx)]);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  expect(await primaryActions(page).count()).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);

  // Detalle de una misión de la semilla: una acción del ciclo a la vista y el resto en menús.
  await page.goto('/missions');
  await page.locator('main a[href^="/missions/"]:not([href$="/new"])').first().click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: es.missionDetail.points.addMenu, exact: true })).toBeVisible();
  expect(await primaryActions(page).count()).toBeLessThanOrEqual(1);
  const rowMenus = page.getByRole('button', { name: /^Acciones de «/ });
  if ((await rowMenus.count()) > 0) {
    await rowMenus.first().click();
    await expect(page.getByRole('menuitem', { name: es.missionRoutes.remove.action, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expectNoHorizontalOverflow(page);
});
