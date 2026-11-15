// Demostración de H1 (doc 07 §3, plan §6) contra la pila `compose.yml` + `infra/compose.e2e.yml`, en escritorio y en 375 px.
// El coordinador crea una misión pinchando el objetivo en el mapa, añade orígenes por coordenadas (decimal y GMS) y por dirección,
// un punto intermedio y uno de reunión, cambia de capa, ve el tiempo/luz/luna, la activa con el aviso, el rescatista la ve sin rutas,
// la cierra y la reabre, y el historial lo refleja. Después, una organización ajena recibe 404 y un recorrido solo con teclado y en francés.
// Todo es ficticio y determinista: las direcciones y el tiempo vienen de `providers-stub`, el terreno del DEM sintético y las teselas
// de IGN se sustituyen por una imagen vacía. Cada ejecución crea sus propias misiones con nombre único y las deja CERRADAS (el
// registro de auditoría es de solo añadir: no se pueden retirar, solo cerrar; `docker compose down -v` las borra con la pila).
import type { Page } from '@playwright/test';
import { ACCOUNTS, chooseMapLayer, fr, mapLayerButton } from './support/app';
import { DEVICE_AT, DEVICE_CELL, DEVICE_DOWN, clickMapCenter, es, expect, expectNoHorizontalOverflow, expectWithinViewportWidth, login, openSession, tabTo, test } from './support/demo';
import { ORG_B, demo } from './support/stack';

const STAMP = Date.now().toString(36).slice(-6);

test.use({ geolocation: { latitude: DEVICE_AT.latitude, longitude: DEVICE_AT.longitude }, permissions: ['geolocation'] });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

// Estado que pasa de una prueba a la siguiente dentro de cada proyecto (escritorio y móvil corren cada uno su recorrido).
const run = { name: '', id: '', target: '' };
const missionName = (info: { project: { name: string } }) => `E2E ${info.project.name} ${STAMP}`;

const main = (page: Page) => page.getByRole('main');
const mapRegion = (page: Page) => page.getByRole('region', { name: es.missionDetail.mapRegion });
const statusBadge = (page: Page, text: string) => page.locator('.detail-head .status-badge', { hasText: text });

/** Rellena un punto por coordenadas dentro de su grupo (origen del formulario o formulario de punto). */
async function byCoordinates(group: ReturnType<Page['getByRole']>, text: string): Promise<void> {
  await group.getByRole('radio', { name: es.point.byCoordinates }).check();
  const field = group.getByRole('textbox', { name: es.point.coordinates, exact: true });
  await field.fill(text);
  await field.press('Enter'); // Intro aplica las coordenadas sin enviar el formulario
  await expect(group.getByText(/^Punto elegido: /)).toBeVisible();
}

test('the coordinator creates a mission by clicking the target and adds three origins (decimal, DMS and address)', async ({ page }, info) => {
  run.name = missionName(info);
  await login(page, ACCOUNTS.coordinator);
  await expect(page).toHaveURL(/\/home$/);

  // Cuenta de llamadas a la búsqueda de direcciones: ninguna al teclear, una al pulsar Buscar (RF-401, D-H1-16).
  const geocodeCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/geo/geocode')) geocodeCalls.push(request.url());
  });

  await main(page).getByRole('link', { name: es.nav.createMission }).click();
  await expect(page).toHaveURL(/\/missions\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: es.createMission.title })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Issue #8: a partir de 1024 px el mapa llena su contenedor, sin hueco vacío debajo (la regla base de `.map-canvas` ganaba al bloque de escritorio).
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const region = page.getByRole('region', { name: es.createMission.mapRegion });
    await expect(region.locator('.maplibregl-canvas')).toBeVisible();
    const emptySpace = await region.evaluate((view) => view.clientHeight - [...view.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0));
    expect(emptySpace).toBeLessThanOrEqual(1);
  } else {
    // Columna (UI-rediseno T7): el mapa no baja de 320 px y mide al menos el 40 % del alto de la ventana (a 375x812, 325 px como mínimo; se miden 341 px).
    const viewportHeight = page.viewportSize()?.height ?? 0;
    const canvas = page.getByRole('region', { name: es.createMission.mapRegion }).locator('.map-canvas');
    await expect(canvas).toBeVisible();
    const canvasHeight = (await canvas.boundingBox())!.height;
    expect(canvasHeight).toBeGreaterThanOrEqual(320);
    expect(canvasHeight).toBeGreaterThanOrEqual(viewportHeight * 0.4);
  }

  // Sin datos, el botón de crear avisa de por qué no se puede pulsar.
  const submit = page.getByRole('button', { name: es.createMission.submit });
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText(es.createMission.incomplete)).toBeVisible();

  await page.getByLabel(es.createMission.name).fill(run.name);
  await expect(page.getByLabel(es.createMission.coordinator)).toHaveValue(/.+/); // por defecto, quien crea

  // El objetivo: se pincha en el mapa (el punto espera el clic desde el principio).
  const objective = page.getByRole('group', { name: es.createMission.objective });
  await clickMapCenter(page.getByRole('region', { name: es.createMission.mapRegion }));
  const picked = objective.getByText(/^Punto elegido: /);
  await expect(picked).toBeVisible();
  run.target = (await picked.innerText()).replace('Punto elegido: ', '');
  // La altitud la pone el servidor (DEM sintético o su respaldo): el formulario la muestra, no la calcula.
  await expect(objective.getByText(/^Altitud: [\d.,]+ m$/)).toBeVisible();
  await expect(submit).toHaveAttribute('aria-disabled', 'false');

  // Origen 1: coordenadas decimales.
  const addOrigin = page.getByRole('button', { name: es.createMission.addOrigin });
  await addOrigin.click();
  const origin1 = page.getByRole('group', { name: 'Origen 1', exact: true });
  await origin1.getByLabel(es.createMission.originName).fill('Origen decimal');
  await byCoordinates(origin1, '42.6481, -0.0405');

  // Origen 2: grados, minutos y segundos.
  await addOrigin.click();
  const origin2 = page.getByRole('group', { name: 'Origen 2', exact: true });
  await origin2.getByLabel(es.createMission.originName).fill('Origen GMS');
  await byCoordinates(origin2, '42°38′00.6″N 0°06′07.6″E');
  await expect(origin2.getByText(/^Punto elegido: 42\.6335/)).toBeVisible();

  // Origen 3: por dirección. Teclear no llama al servidor; Buscar, una vez.
  await addOrigin.click();
  const origin3 = page.getByRole('group', { name: 'Origen 3', exact: true });
  await origin3.getByLabel(es.createMission.originName).fill('Origen dirección');
  await origin3.getByRole('radio', { name: es.point.byAddress }).check();
  const address = origin3.getByRole('textbox', { name: es.point.address, exact: true });
  await address.pressSequentially('Torla', { delay: 30 });
  await page.waitForTimeout(400);
  expect(geocodeCalls, 'teclear no lanza la búsqueda').toHaveLength(0);
  await origin3.getByRole('button', { name: es.point.search, exact: true }).click();
  await expect(origin3.getByText(es.point.candidates)).toBeVisible();
  expect(geocodeCalls).toHaveLength(1);
  await origin3.getByRole('radio', { name: /Torla \(ficticio\)/ }).check(); // mismo país que la organización: sin confirmación
  await expect(origin3.getByText(/^Punto elegido: 42\.6297/)).toBeVisible();
  await expect(origin3.locator('.point-summary-label')).toContainText('Torla (ficticio)');
  await expectNoHorizontalOverflow(page);

  await submit.click();
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/);
  run.id = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name: run.name })).toBeVisible();
  await expect(statusBadge(page, es.missions.status.planning)).toBeVisible();

  // La misión nace con su objetivo y los tres orígenes, con la altitud puesta por el servidor.
  const origins = page.getByRole('region', { name: es.missionDetail.points.groups.origin });
  for (const name of ['Origen decimal', 'Origen GMS', 'Origen dirección']) {
    await expect(origins.getByRole('listitem').filter({ hasText: name }).first()).toContainText(/Altitud: [\d.,]+ m/);
  }
  await expect(page.getByText(`Objetivo`, { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('adds a waypoint and a rendezvous point, and switches the three map layers with their attributions in sight', async ({ page, network }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/missions/${run.id}`);
  await expect(page.getByRole('heading', { level: 1, name: run.name })).toBeVisible();

  // Punto intermedio por coordenadas.
  await page.getByRole('button', { name: es.missionDetail.points.add.waypoint }).click();
  const waypointForm = page.getByRole('group', { name: es.missionDetail.points.addTitle.waypoint });
  await waypointForm.getByLabel(es.missionDetail.points.name).fill('Intermedio E2E');
  await byCoordinates(waypointForm, '42.664, 0.005');
  await waypointForm.getByRole('button', { name: es.missionDetail.points.save }).click();
  await expect(page.getByText(es.missionDetail.points.added.replace('{{name}}', 'Intermedio E2E'))).toBeVisible();

  // Punto de reunión por dirección en otro país (Gavarnie, Francia): hay que confirmar antes de usarlo (doc 02 §3.4).
  await page.getByRole('button', { name: es.missionDetail.points.add.rendezvous }).click();
  const rendezvousForm = page.getByRole('group', { name: es.missionDetail.points.addTitle.rendezvous });
  await rendezvousForm.getByLabel(es.missionDetail.points.name).fill('Reunión E2E');
  await rendezvousForm.getByRole('radio', { name: es.point.byAddress }).check();
  await rendezvousForm.getByRole('textbox', { name: es.point.address, exact: true }).fill('Gavarnie');
  await rendezvousForm.getByRole('button', { name: es.point.search, exact: true }).click();
  await rendezvousForm.getByRole('radio', { name: /Gavarnie \(ficticio\)/ }).check();
  await expect(rendezvousForm.getByText(/^Este lugar está en Francia y tu organización trabaja en España/)).toBeVisible();
  await expect(rendezvousForm.getByText(/^Punto elegido: /)).toHaveCount(0); // aún sin confirmar
  await rendezvousForm.getByRole('button', { name: es.point.confirmOtherCountry }).click();
  await expect(rendezvousForm.getByText(/^Punto elegido: 42\.7333/)).toBeVisible();
  await rendezvousForm.getByRole('button', { name: es.missionDetail.points.save }).click();
  await expect(page.getByText(es.missionDetail.points.added.replace('{{name}}', 'Reunión E2E'))).toBeVisible();

  const waypoints = page.getByRole('region', { name: es.missionDetail.points.groups.waypoint });
  const rendezvous = page.getByRole('region', { name: es.missionDetail.points.groups.rendezvous });
  await expect(waypoints.getByRole('listitem').filter({ hasText: 'Intermedio E2E' }).first()).toContainText(/Altitud: [\d.,]+ m/);
  await expect(rendezvous.getByRole('listitem').filter({ hasText: 'Reunión E2E' }).first()).toContainText(/Altitud: [\d.,]+ m/);
  await expectNoHorizontalOverflow(page);

  // Las tres capas: cada una cita lo suyo, a la vista (también a 375 px) y sin plegar.
  const map = mapRegion(page);
  await map.scrollIntoViewIfNeeded();
  const attribution = map.getByRole('list', { name: es.map.attribution.label });

  await expect(mapLayerButton(map, es.map.layers.topographic)).toBeVisible(); // capa inicial
  await expect(attribution).toContainText(es.map.attribution.ignEs);
  await expect(attribution).toContainText(es.map.attribution.ignFr);
  await expectWithinViewportWidth(page, attribution);

  await chooseMapLayer(map, es.map.layers.satellite);
  await mapLayerButton(map).click();
  await expect(map.getByRole('menuitemradio', { name: es.map.layers.satellite, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(map.getByRole('menuitemradio', { name: es.map.layers.topographic, exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(attribution).toContainText(es.map.attribution.ignEsSatellite);
  await expect(attribution).toContainText(es.map.attribution.ignFr);
  await expectWithinViewportWidth(page, attribution);

  await chooseMapLayer(map, es.map.layers.roads);
  await expect(attribution).toContainText(es.map.attribution.osm);
  await expect(attribution).not.toContainText(es.map.attribution.ignFr);
  await expectWithinViewportWidth(page, attribution);

  await chooseMapLayer(map, es.map.layers.satellite);
  await expect(attribution).toContainText(es.map.attribution.ignEsSatellite);
  // La vigilancia de red alcanza a las teselas: se pidieron a IGN (respondidas por la imagen vacía) y a nadie más.
  await expect.poll(() => network.ignRequests).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
});

test('a rescuer does not see the mission while it is in planning', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.rescuer);
  await page.goto('/missions');
  await expect(page.getByRole('heading', { level: 1, name: es.myMissions.title })).toBeVisible();
  await page.getByLabel(es.missions.searchLabel).fill(run.name);
  await page.getByLabel(es.missions.searchLabel).press('Enter');
  await expect(page.getByText(es.missions.emptySearch.replace('{{query}}', run.name))).toBeVisible();
  // Por dirección directa, tampoco: 404, no 403 (INV-08, RN-16).
  await page.goto(`/missions/${run.id}`);
  await expect(page.getByText(es.errors.NOT_FOUND)).toBeVisible();
  const direct = await page.request.get(`/api/v1/my/missions/${run.id}`);
  expect(direct.status()).toBe(404);
  await expectNoHorizontalOverflow(page);
});

test('activating asks for confirmation because no route is validated, and only activates when confirmed', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/missions/${run.id}`);
  await expect(statusBadge(page, es.missions.status.planning)).toBeVisible();

  await page.getByRole('button', { name: es.missionDetail.lifecycle.activate, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: es.missionDetail.lifecycle.activateWarning.title });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(es.missionDetail.lifecycle.activateWarning.body);
  await expectNoHorizontalOverflow(page);

  // Cancelar no activa nada.
  await dialog.getByRole('button', { name: es.missionDetail.lifecycle.activateWarning.cancel }).click();
  await expect(dialog).toBeHidden();
  await expect(statusBadge(page, es.missions.status.planning)).toBeVisible();

  await page.getByRole('button', { name: es.missionDetail.lifecycle.activate, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: es.missionDetail.lifecycle.activateWarning.confirm }).click();
  await expect(statusBadge(page, es.missions.status.active)).toBeVisible();
  await expect(page.getByText(es.missionDetail.lifecycle.activated)).toBeVisible();
  await expect(page.getByRole('button', { name: es.missionDetail.lifecycle.close, exact: true })).toBeVisible();
});

test('the home shows the simple weather card for the granted device location and for the mission target, and its button opens the full detail', async ({ page }) => {
  // La ubicación concedida lleva decimales de más: lo que sale del navegador ya está redondeado a la celda (INV-30).
  const environmentCalls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/environment')) environmentCalls.push(request.url());
  });
  await login(page, ACCOUNTS.coordinator);
  await expect(page).toHaveURL(/\/home$/);

  // Inicio (issue #18): tres iconos por tramo del día, el termómetro con la temperatura y el viento; nada técnico, ni luz y luna.
  const section = page.getByRole('region', { name: es.environment.title, exact: true });
  await expect(section.locator('.env-basis')).toContainText(es.environment.basis.device);
  const weather = section.getByRole('region', { name: es.environment.weather.title, exact: true });
  await expect(weather).toHaveAttribute('data-status', 'ok');
  await expect(weather.getByRole('list', { name: es.environment.simple.partsLabel }).getByRole('listitem')).toHaveCount(3);
  await expect(weather.locator('.wx-now')).toContainText('°C');
  await expect(weather.locator('.wx-now')).toContainText('km/h');
  await expect(weather).toContainText(es.environment.weather.attribution); // Open-Meteo, citado en texto (RF-704)
  await expect(weather.getByText(es.environment.weather.freezingLevel)).toHaveCount(0);
  await expect(section.getByRole('region', { name: es.environment.light.title, exact: true })).toHaveCount(0);
  await expect(section.locator('.env-place')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // El botón lleva al detalle del mismo punto: todo lo que ya no cabe en la tarjeta, y la luz y la luna. La posición no viaja en la dirección.
  await weather.getByRole('link', { name: es.environment.simple.detailCta }).click();
  await expect(page).toHaveURL(/\/weather$/);
  await expect(page.getByRole('heading', { level: 1, name: es.environment.detail.title })).toBeVisible();
  const detail = page.getByRole('region', { name: es.environment.weather.title, exact: true });
  const light = page.getByRole('region', { name: es.environment.light.title, exact: true });
  await expect(detail).toHaveAttribute('data-status', 'ok');
  await expect(detail.getByText(es.environment.weather.temperature)).toBeVisible();
  await expect(detail.getByText(es.environment.weather.freezingLevel)).toBeVisible();
  await expect(detail).toContainText(es.environment.weather.attribution);
  await expect(light.getByText(es.environment.light.sunrise)).toBeVisible();
  await expect(light.getByText(es.environment.light.sunset)).toBeVisible();
  await expect(light.getByText(/% iluminada/)).toBeVisible();
  await expect(page.locator('.env-place')).toContainText(`${DEVICE_CELL.lat}`);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: es.environment.detail.backHome }).click();
  await expect(page).toHaveURL(/\/home$/);

  // Al elegir la misión (ya activa), la tarjeta pasa a ser la de su objetivo, el botón mira ese objetivo y hay camino de vuelta.
  await page.getByRole('button', { name: es.home.pickLabel.replace('{{name}}', run.name) }).click();
  await expect(section.locator('.env-basis')).toContainText(es.environment.basis.mission.replace('{{name}}', run.name));
  await expect(page.getByRole('status').filter({ hasText: es.environment.announceMission.replace('{{name}}', run.name) })).toBeAttached();
  await expect(weather).toHaveAttribute('data-status', 'ok');
  await weather.getByRole('link', { name: es.environment.simple.detailCta }).click();
  await expect(page).toHaveURL(/\/weather\?mission=[0-9a-f-]{36}$/);
  await expect(page.locator('.env-basis')).toContainText(es.environment.basis.missionUnnamed);
  await expect(page.locator('.env-place')).toContainText(run.target);
  await expect(page.getByRole('region', { name: es.environment.light.title, exact: true }).getByText(es.environment.light.sunrise)).toBeVisible();
  await expect(page.getByRole('link', { name: es.environment.detail.backToMission })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.goto('/home');
  await expect(section.locator('.env-basis')).toContainText(es.environment.basis.device);
  await expectNoHorizontalOverflow(page);
});

test('when the weather provider is down the card says so and the rest of the home keeps working', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.coordinator, { geolocation: DEVICE_DOWN, permissions: ['geolocation'] });
  await expect(page).toHaveURL(/\/home$/);
  const section = page.getByRole('region', { name: es.environment.title, exact: true });
  const weather = section.getByRole('region', { name: es.environment.weather.title, exact: true });
  await expect(weather).toHaveAttribute('data-status', 'unavailable');
  await expect(weather.getByText(es.environment.weather.unavailable)).toBeVisible();
  await expect(weather.getByRole('button', { name: es.environment.weather.retry })).toBeVisible();
  // Nada más se rompe: la lista de misiones sigue ahí y la luz y la luna (que se calculan sin proveedor) siguen en el detalle.
  await expect(page.getByRole('link', { name: run.name })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Y al elegir una misión, su objetivo (otra celda) sí tiene tiempo.
  await page.getByRole('button', { name: es.home.pickLabel.replace('{{name}}', run.name) }).click();
  await expect(section.getByRole('region', { name: es.environment.weather.title, exact: true })).toHaveAttribute('data-status', 'ok');
  await expectNoHorizontalOverflow(page);
});

test('the rescuer sees the active mission in read only, with its points and no routes', async ({ roleContext }) => {
  const page = await openSession(roleContext, ACCOUNTS.rescuer, { geolocation: DEVICE_AT, permissions: ['geolocation'] });
  await page.goto('/missions');
  await expect(page.getByRole('heading', { level: 1, name: es.myMissions.title })).toBeVisible();
  // El tiempo, versión reducida del inicio, va arriba de la lista.
  await expect(page.getByRole('region', { name: es.environment.title, exact: true })).toBeVisible();

  await page.getByLabel(es.missions.searchLabel).fill(run.name);
  await page.getByLabel(es.missions.searchLabel).press('Enter');
  const card = page.getByRole('listitem').filter({ hasText: run.name });
  await expect(card).toBeVisible();
  await expect(card).toContainText(es.missions.status.active);
  await expect(card).toContainText(es.myMissions.participation.none);
  await expectNoHorizontalOverflow(page);

  await card.getByRole('link', { name: run.name }).click();
  await expect(page).toHaveURL(new RegExp(`/missions/${run.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: run.name })).toBeVisible();
  await expect(page.getByText(es.myMissions.detail.readOnly)).toBeVisible();
  await expect(page.getByText(es.myMissions.detail.noRoutes)).toBeVisible();
  for (const name of ['Origen decimal', 'Origen GMS', 'Origen dirección', 'Intermedio E2E', 'Reunión E2E']) {
    await expect(main(page).getByText(name, { exact: true })).toBeVisible();
  }
  // El tiempo del objetivo y un mapa sin altitud (el rescatista no tiene `getElevation`).
  await expect(page.getByRole('region', { name: es.myMissions.detail.environmentTitle, exact: true })).toBeVisible();
  await expect(mapRegion(page)).toBeVisible();
  await expect(mapRegion(page).getByText(es.map.cursor.hintNoElevation)).toBeVisible();
  // Ningún control de escritura ni de oferta (la oferta llega en H6).
  await expect(main(page).getByRole('button', { name: /Activar|Cerrar misión|Reabrir|Duplicar|Editar|Añadir|Borrar|Guardar|ofrezco|voluntari/i })).toHaveCount(0);
  await expect(main(page).getByRole('textbox')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Y el API se lo confirma: la edición es cosa del personal (403, nunca 404 ni 200).
  const staffOnly = await page.request.get(`/api/v1/missions/${run.id}`);
  expect(staffOnly.status()).toBe(403);
});

test('the coordinator closes the mission without an attendance dialog and reopens it', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/missions/${run.id}`);
  await page.getByRole('button', { name: es.missionDetail.lifecycle.close, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: es.missionDetail.lifecycle.closeDialog.title });
  await expect(dialog).toContainText(es.missionDetail.lifecycle.closeDialog.noParticipants); // cero aceptados: solo confirma
  await dialog.getByRole('button', { name: es.missionDetail.lifecycle.closeDialog.confirm }).click();

  await expect(statusBadge(page, es.missions.status.closed)).toBeVisible();
  await expect(page.getByText(es.missionDetail.lifecycle.closed)).toBeVisible();
  // Cerrada es de solo lectura: ningún control de escritura, y se puede reabrir.
  await expect(page.getByText(es.missionDetail.readOnlyClosed)).toBeVisible();
  await expect(page.getByRole('button', { name: es.missionDetail.editData })).toHaveCount(0);
  await expect(page.getByRole('button', { name: es.missionDetail.points.add.origin })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: es.missionDetail.lifecycle.reopen, exact: true }).click();
  await expect(statusBadge(page, es.missions.status.active)).toBeVisible();
  await expect(page.getByText(es.missionDetail.lifecycle.reopened)).toBeVisible();
  await expect(page.getByRole('button', { name: es.missionDetail.editData })).toBeVisible();
});

test('the history reflects every change in order, and the mission is left closed', async ({ page }) => {
  await login(page, ACCOUNTS.coordinator);
  await page.goto(`/missions/${run.id}`);
  const history = page.getByRole('region', { name: es.missionDetail.history.title, exact: true });
  const actions = history.locator('.history-item');
  await expect(actions.first()).toHaveAttribute('data-action', 'mission_reopened');
  const seen = await actions.evaluateAll((items) => items.map((item) => item.getAttribute('data-action')));
  // De más nuevo a más antiguo: reabrir, cerrar, activar, los dos puntos añadidos después y, al final, la creación.
  expect(seen.slice(0, 5)).toEqual(['mission_reopened', 'mission_closed', 'mission_activated', 'point_added', 'point_added']);
  expect(seen.at(-1)).toBe('mission_created');
  await expect(history).toContainText(es.missionDetail.history.actions.mission_activated);
  await expect(history).toContainText(es.missionDetail.history.actions.mission_closed);
  await expect(history).toContainText(es.missionDetail.history.actions.mission_reopened);
  await expect(history).toContainText(demo.members.find((m) => m.email === ACCOUNTS.coordinator.email)!.displayName); // el actor, con su nombre; los textos técnicos de la acción no salen
  await expect(history).not.toContainText('mission_activated');
  await expectNoHorizontalOverflow(page);

  // La misión se deja cerrada para no ensuciar la lista de activas de la pila.
  await page.getByRole('button', { name: es.missionDetail.lifecycle.close, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: es.missionDetail.lifecycle.closeDialog.confirm }).click();
  await expect(statusBadge(page, es.missions.status.closed)).toBeVisible();
});

test('another organization gets 404 for the mission, through the API and through the web (INV-01)', async ({ roleContext }) => {
  const page = await openSession(roleContext, { email: ORG_B.adminEmail, password: ORG_B.password });
  await expect(page.locator('.org-name')).toHaveText(ORG_B.name);

  // Por el API con la sesión de B: la misión de A no existe para ella, ni en el detalle ni en el historial. 404, nunca 403.
  for (const path of [`/api/v1/missions/${run.id}`, `/api/v1/missions/${run.id}/history`]) {
    const answer = await page.request.get(path);
    expect(answer.status(), path).toBe(404);
    expect(((await answer.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  }
  // Las listas de B no contienen nada de A, en ninguna pestaña.
  for (const status of ['planning', 'active', 'closed']) {
    const list = await page.request.get(`/api/v1/missions?status=${status}`);
    expect(list.status()).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain(run.name);
  }

  // Por la web: la dirección de A no abre nada y no delata que exista.
  await page.goto(`/missions/${run.id}`);
  await expect(page.getByText(es.errors.NOT_FOUND)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(run.name);
  await page.goto('/missions');
  await expect(page.locator('body')).not.toContainText(run.name);
  await expectNoHorizontalOverflow(page);
});

test('the whole journey works with the keyboard only and in French: create, activate and close', async ({ page }, info) => {
  const frName = `E2E FR ${info.project.name} ${STAMP}`;
  const key = (name: string) => page.keyboard.press(name);

  // Francés elegido en el acceso (el idioma del navegador gana al del perfil); entrar con el teclado.
  await page.goto('/login');
  await page.getByLabel(es.account.languageFr).check();
  await page.getByLabel(fr.login.email).fill(ACCOUNTS.coordinatorFr.email);
  await page.getByLabel(fr.login.password).fill(ACCOUNTS.coordinatorFr.password);
  await page.getByLabel(fr.login.password).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1, name: fr.home.title })).toBeVisible();
  // En francés también el tiempo: el título y la atribución salen de packages/i18n.
  await expect(page.getByRole('region', { name: fr.environment.title, exact: true })).toBeVisible();

  await page.goto('/missions/new');
  await expect(page.getByRole('heading', { level: 1, name: fr.createMission.title })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Nombre.
  await tabTo(page, page.getByLabel(fr.createMission.name));
  await page.keyboard.type(frName);
  // Objetivo: grupo de opciones con las flechas (Mapa -> Coordenadas), texto, Intro.
  const objective = page.getByRole('group', { name: fr.createMission.objective });
  await tabTo(page, objective.getByRole('radio', { name: fr.point.byMap }));
  await key('ArrowRight');
  await expect(objective.getByRole('radio', { name: fr.point.byCoordinates })).toBeChecked();
  await tabTo(page, objective.getByRole('textbox', { name: fr.point.coordinates, exact: true }));
  await page.keyboard.type('42.7897, -0.2814');
  await key('Enter');
  await expect(objective.getByText(/^Point choisi : 42\.7897/)).toBeVisible();
  // Crear: el botón se alcanza con Tab y se pulsa con Intro.
  const create = page.getByRole('button', { name: fr.createMission.submit });
  await tabTo(page, create);
  await key('Enter');
  await expect(page).toHaveURL(/\/missions\/[0-9a-f-]{36}$/);
  const frId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name: frName })).toBeVisible();
  await expect(page.locator('.detail-head .status-badge', { hasText: fr.missions.status.planning })).toBeVisible();

  // Activar con el aviso: el foco empieza en la opción segura («Pas maintenant»); Mayús+Tab llega a confirmar.
  await tabTo(page, page.getByRole('button', { name: fr.missionDetail.lifecycle.activate, exact: true }));
  await key('Enter');
  const warning = page.getByRole('dialog', { name: fr.missionDetail.lifecycle.activateWarning.title });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('button', { name: fr.missionDetail.lifecycle.activateWarning.cancel })).toBeFocused();
  await key('Shift+Tab');
  await expect(warning.getByRole('button', { name: fr.missionDetail.lifecycle.activateWarning.confirm })).toBeFocused();
  await key('Enter');
  await expect(page.locator('.detail-head .status-badge', { hasText: fr.missions.status.active })).toBeVisible();
  await expect(page.getByText(fr.missionDetail.lifecycle.activated)).toBeVisible();
  await expect(page.locator('#mission-title')).toBeFocused(); // el foco no se pierde: vuelve al título

  // Su historial, en francés.
  await expect(page.getByRole('region', { name: fr.missionDetail.history.title, exact: true })).toContainText(fr.missionDetail.history.actions.mission_activated);
  await expectNoHorizontalOverflow(page);

  // Clôturer, con el mismo gesto; la misión queda cerrada y de solo lectura.
  await tabTo(page, page.getByRole('button', { name: fr.missionDetail.lifecycle.close, exact: true }));
  await key('Enter');
  const closing = page.getByRole('dialog', { name: fr.missionDetail.lifecycle.closeDialog.title });
  await expect(closing.getByRole('button', { name: fr.missionDetail.lifecycle.closeDialog.cancel })).toBeFocused();
  await key('Escape'); // Escape cierra sin hacer nada y devuelve el foco
  await expect(closing).toBeHidden();
  await expect(page.locator('.detail-head .status-badge', { hasText: fr.missions.status.active })).toBeVisible();
  await expect(page.getByRole('button', { name: fr.missionDetail.lifecycle.close, exact: true })).toBeFocused();
  await key('Enter');
  await key('Shift+Tab');
  await key('Enter');
  await expect(page.locator('.detail-head .status-badge', { hasText: fr.missions.status.closed })).toBeVisible();
  await expect(page.getByText(fr.missionDetail.readOnlyClosed)).toBeVisible();
  expect(frId).toMatch(/^[0-9a-f-]{36}$/);
});
