import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo la web y la API comparten origen a través de este proxy: la cookie de sesión
// (`SameSite=Strict`, `Path=/api`) llega a la API sin CORS. En producción lo hace Caddy (T9).
const apiTarget = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Los paquetes internos se consumen desde su fuente con la condición `source` (D-H0-15).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  server: { port: 5173, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  preview: { port: 4173, proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
