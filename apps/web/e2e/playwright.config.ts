import { defineConfig, devices } from '@playwright/test';

// Demostración de H0 a H5-acceso y de la issue #17 (doc 07 §3) contra la pila real de `docker compose up --wait` (T9). No arranca nada:
// se espera que la pila ya esté en pie en E2E_BASE_URL (http://localhost:8080 por defecto).
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // El runner del CI es lento (dos núcleos, WebGL por software y tres demostraciones con mapa en dos formatos): más margen que los 5 s por defecto.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  workers: process.env.CI ? 2 : undefined,
  // Los informes y trazas se escriben junto a esta configuración (ignorados por git); el CI los sube solo si algo falla.
  outputDir: './test-results',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: './report' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    locale: 'es-ES',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /(mobile|h3-engine-down)\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Móvil de 375 px de ancho (iPhone SE/mini); Chromium con pantalla táctil.
    {
      name: 'mobile',
      testMatch: /(mobile|h1-demo|h2-demo|h3-demo|h4-demo|route-delete-demo|weather-simple-demo|ui-simplificacion-demo|rutas-nombre-demo)\.spec\.ts/,
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } },
    },
    // La demostración de H5-acceso en 375 px. Regenera el código de invitación, que es de TODA la organización: no puede correr a la vez que el
    // registro de escritorio (la misma demostración). Espera a que termine `desktop`; no comparte nada con las demostraciones del proyecto `mobile`.
    { name: 'mobile-access', testMatch: /h5-acceso-demo\.spec\.ts/, dependencies: ['desktop'], use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } } },
    // Para el motor de rutas: corre cuando los otros dos proyectos han terminado, para no romper sus demostraciones.
    { name: 'engine-down', testMatch: /h3-engine-down\.spec\.ts/, dependencies: ['desktop', 'mobile'], use: { ...devices['Desktop Chrome'] } },
  ],
});
