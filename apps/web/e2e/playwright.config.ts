import { defineConfig, devices } from '@playwright/test';

// Demostración de H0 (doc 07 §3) contra la pila real de `docker compose up --wait` (T9). No arranca nada:
// se espera que la pila ya esté en pie en E2E_BASE_URL (http://localhost:8080 por defecto).
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
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
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Móvil de 375 px de ancho (iPhone SE/mini); Chromium con pantalla táctil.
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } } },
  ],
});
