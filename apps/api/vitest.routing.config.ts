import { defineConfig } from 'vitest/config';

// Suite contra el motor de rutas REAL (GraphHopper) sobre la red inventada del E2E (H3, D-H3-05):
//   COMPOSE_FILE=compose.yml:infra/compose.e2e.yml docker compose up --wait routing && pnpm --filter @onway/api test:routing
// El motor se publica en 127.0.0.1:18989 con la superposición E2E; `ROUTING_URL` apunta a otro.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: { include: ['test/routing/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
});
