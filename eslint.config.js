// ESLint plano para todo el monorepo (H1-T1, P5). Configuración recomendada de `eslint` y de
// `typescript-eslint` SIN reglas que necesiten tipos (rápido, sin `parserOptions.project`).
// Además fija el límite del mapa (D-H1-07, regla inviolable 9): ni MapLibre ni geometría en páginas y
// componentes de React.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Funciones de `@onway/geo` que pueden importar las páginas y los componentes de `apps/web/src/**`
 * fuera de `src/map/`: solo lectura y formato de coordenadas (decimal, grados-minutos-segundos y UTM),
 * nunca geometría de rutas. T6 añade la lectura de coordenadas y su error; el formato de coordenadas lo usan las páginas para mostrar un punto.
 * T9 añade `roundToCell` (INV-30): la ubicación del dispositivo se redondea a la celda de ~1 km en el cliente antes de usarse; es
 * redondeo de privacidad, no geometría de rutas.
 * Es la única lista: ampliarla es una decisión de diseño, no un arreglo de lint.
 * @type {readonly string[]}
 */
export const ALLOWED_GEO_IMPORTS = ['parseCoordinates', 'formatCoordinate', 'CoordinateError', 'roundToCell'];

const MAP_MESSAGE = 'MapLibre, react-map-gl y pmtiles solo se importan desde apps/web/src/map/ (D-H1-07); las páginas pasan datos a ese módulo.';
const GEO_MESSAGE = 'Las páginas y los componentes solo pueden importar de @onway/geo la lectura y el formato de coordenadas (decimal, GMS y UTM); la geometría vive en packages/geo o en el servidor.';

const mapLibraries = ['maplibre-gl', 'maplibre-gl/**', 'react-map-gl', 'react-map-gl/**', 'pmtiles', 'pmtiles/**'];

/**
 * Reglas del límite del mapa para `apps/web/src/**` fuera de `src/map/`. Recibe la lista de funciones
 * permitidas de `@onway/geo` para que la prueba del límite compruebe el caso «permitida» y «no permitida»
 * sin tocar la lista real.
 * @param {readonly string[]} allowedGeoImports
 */
export function webBoundaryRules(allowedGeoImports = ALLOWED_GEO_IMPORTS) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: mapLibraries, message: MAP_MESSAGE },
          {
            // El paquete, salvo la lista explícita de nombres permitidos.
            group: ['@onway/geo'],
            message: GEO_MESSAGE,
            // `allowImportNames` exige al menos un nombre: con la lista vacía se prohíbe el paquete entero.
            ...(allowedGeoImports.length > 0 ? { allowImportNames: [...allowedGeoImports] } : {}),
          },
          // Ninguna subruta (el paquete solo exporta su índice): no hay lista que valga.
          { group: ['@onway/geo/**'], message: GEO_MESSAGE },
        ],
      },
    ],
  };
}

export default defineConfig([
  globalIgnores(['**/node_modules/**', '**/dist/**', '**/gen/**', '**/coverage/**', 'apps/web/e2e/report/**', 'apps/web/e2e/test-results/**', 'apps/web/test-results/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Convención habitual: un argumento o variable que empieza por `_` está sin usar a propósito.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    // Scripts de Node sin transpilar (infra/): los globales de Node que usan, declarados a mano (sin añadir el paquete `globals`).
    files: ['infra/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    // Límite del mapa: todo `apps/web/src` salvo el módulo `src/map/`.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/map/**'],
    rules: webBoundaryRules(),
  },
]);
