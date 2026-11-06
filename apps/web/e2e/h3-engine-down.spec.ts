// H3: con el motor de rutas parado, generar responde con un mensaje claro y el resto de la aplicación sigue funcionando (doc 04 §11.4).
// Va aparte de h3-demo.spec.ts y corre cuando los otros proyectos han terminado (`dependencies` en la configuración): parar el motor
// durante las demás demostraciones las rompería.
import { ACCOUNTS } from './support/app';
import { es, expect, login, test } from './support/demo';
import { startRoutingEngine, stopRoutingEngine } from './support/stack';

const G = es.generate;

// Cuánto tarda la API en decir que el motor no está. `generateRoutes` pregunta antes a `GET /health` del motor, con un tope propio de
// 5 s (`isAvailable` en apps/api/src/routing/graphhopper-routing.ts), y con el contenedor parado el nombre `routing` deja de resolverse:
// en la pila de pruebas (el motor también está en la red `edge`, no interna) el DNS de Docker reenvía la consulta fuera y el fallo tarda
// de 3 a 6 s (medido: 4,5 a 5,5 s desde el clic hasta ver el aviso). La espera por defecto (5 s en local) queda justo por debajo.
const ENGINE_DOWN_DETECTION_MS = 20_000;

test('with the routing engine stopped, generating says so and missions and routes keep working', async ({ page }) => {
  test.setTimeout(240_000);
  await stopRoutingEngine();
  try {
    await login(page, ACCOUNTS.coordinator);
    await page.goto('/routes/generate');
    await page.getByRole('radio', { name: es.point.byCoordinates }).nth(0).check();
    await page.getByRole('textbox', { name: es.point.coordinates, exact: true }).nth(0).fill('42.63, -0.07');
    await page.getByRole('textbox', { name: es.point.coordinates, exact: true }).nth(0).press('Enter');
    await page.getByRole('radio', { name: es.point.byCoordinates }).nth(1).check();
    await page.getByRole('textbox', { name: es.point.coordinates, exact: true }).nth(1).fill('42.69, -0.02');
    await page.getByRole('textbox', { name: es.point.coordinates, exact: true }).nth(1).press('Enter');
    await page.getByRole('button', { name: G.submit }).click();
    await expect(page.getByRole('alert').filter({ hasText: es.errors.ROUTING_UNAVAILABLE })).toBeVisible({ timeout: ENGINE_DOWN_DETECTION_MS });

    // Lo demás sigue: la lista de misiones, la biblioteca de rutas y una ruta ya guardada.
    await page.goto('/missions');
    await expect(page.getByRole('heading', { level: 1, name: es.missions.title })).toBeVisible();
    await page.goto('/routes');
    await expect(page.getByRole('heading', { level: 1, name: es.routes.title })).toBeVisible();
    await page.getByRole('link', { name: 'Pradera a la Brecha (ficticia)', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pradera a la Brecha (ficticia)' })).toBeVisible();
  } finally {
    await startRoutingEngine();
  }
});
