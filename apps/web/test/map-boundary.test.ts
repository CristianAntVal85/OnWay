// Regla de límites del mapa (H1-T1, D-H1-07, regla inviolable 9): ni MapLibre ni geometría en páginas y componentes.
// Ejecuta ESLint de verdad, con la configuración de la raíz, sobre fragmentos que se comprueban sin escribirlos en disco.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const CONFIG = join(ROOT, 'eslint.config.js');
const PAGE = join(ROOT, 'apps/web/src/pages/example-page.tsx');
const COMPONENT = join(ROOT, 'apps/web/src/components/example.tsx');
const MAP_MODULE = join(ROOT, 'apps/web/src/map/example-map.tsx');

type ConfigModule = {
  ALLOWED_GEO_IMPORTS: readonly string[];
  webBoundaryRules: (allowed?: readonly string[]) => Linter.RulesRecord;
};
// La ruta va en una variable para que `tsc` no intente tipar el archivo de configuración (JavaScript).
const config = (await import(/* @vite-ignore */ pathToFileURL(CONFIG).href)) as ConfigModule;

const baseline = new ESLint({ cwd: ROOT, overrideConfigFile: CONFIG });
/** Igual que la real, pero con una lista permitida propia. */
const withAllowedList = (allowed: readonly string[]) =>
  new ESLint({
    cwd: ROOT,
    overrideConfigFile: CONFIG,
    overrideConfig: [{ files: ['apps/web/src/**/*.{ts,tsx}'], ignores: ['apps/web/src/map/**'], rules: config.webBoundaryRules(allowed) }],
  });

async function rulesBroken(linter: ESLint, filePath: string, code: string): Promise<string[]> {
  const [result] = await linter.lintText(code, { filePath });
  const fatal = result!.messages.filter((m) => m.fatal);
  expect(fatal).toEqual([]);
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('límite del mapa: apps/web/src fuera de src/map/', () => {
  it('una página que importa maplibre-gl falla', async () => {
    const problems = await rulesBroken(baseline, PAGE, "import maplibregl from 'maplibre-gl';\nexport const x = maplibregl;\n");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/src\/map/);
  });

  it('el mismo import en src/map/ pasa', async () => {
    const code =
      "import maplibregl from 'maplibre-gl';\nimport { Map } from 'react-map-gl/maplibre';\nimport { Protocol } from 'pmtiles';\nimport { distance } from '@onway/geo';\nexport const x = [maplibregl, Map, Protocol, distance];\n";
    expect(await rulesBroken(baseline, MAP_MODULE, code)).toEqual([]);
  });

  it.each([
    ["import { Map } from 'react-map-gl';", 'react-map-gl'],
    ["import { Map } from 'react-map-gl/maplibre';", 'subruta de react-map-gl'],
    ["import { Protocol } from 'pmtiles';", 'pmtiles'],
    ["import 'maplibre-gl/dist/maplibre-gl.css';", 'subruta de maplibre-gl'],
    ["export { default } from 'maplibre-gl';", 'reexportación'],
  ])('en una página falla: %s (%s)', async (line) => {
    expect(await rulesBroken(baseline, PAGE, `${line}\n`)).toHaveLength(1);
  });

  it('un componente también está sujeto a la regla', async () => {
    expect(await rulesBroken(baseline, COMPONENT, "import maplibregl from 'maplibre-gl';\nexport const x = maplibregl;\n")).toHaveLength(1);
  });

  it('la lista real de @onway/geo es lectura y formato de coordenadas más el redondeo de privacidad (INV-30), y lo demás falla en una página', async () => {
    expect(config.ALLOWED_GEO_IMPORTS).toEqual([
      'parseCoordinates',
      'formatCoordinate',
      'CoordinateError',
      'roundToCell',
      'dayPartSymbols',
      'DayPartSymbol',
      'DayPartHour',
      'ClockTime',
      'SunTimes',
      'WeatherSymbol',
    ]);
    const allowed =
      "import { parseCoordinates, formatCoordinate, roundToCell, type CoordinateError } from '@onway/geo';\nexport const x = [parseCoordinates, formatCoordinate, roundToCell, undefined as CoordinateError | undefined];\n";
    expect(await rulesBroken(baseline, PAGE, allowed)).toEqual([]);
    for (const name of ['haversine', 'elevationBand', 'sunLight', 'moonLight', 'toUtm', 'fromUtm', 'formatDms']) {
      const problems = await rulesBroken(baseline, PAGE, `import { ${name} } from '@onway/geo';\nexport const x = ${name};\n`);
      expect(problems, name).toHaveLength(1);
      expect(problems[0]).toMatch(/@onway\/geo/);
    }
  });

  it('con una lista explícita, solo pasan los nombres de la lista', async () => {
    const linter = withAllowedList(['formatCoordinate']);
    expect(await rulesBroken(linter, PAGE, "import { formatCoordinate } from '@onway/geo';\nexport const x = formatCoordinate;\n")).toEqual([]);
    expect(await rulesBroken(linter, PAGE, "import { routeDistance } from '@onway/geo';\nexport const x = routeDistance;\n")).toHaveLength(1);
    expect(await rulesBroken(linter, PAGE, "import { formatCoordinate, routeDistance } from '@onway/geo';\nexport const x = [formatCoordinate, routeDistance];\n")).toHaveLength(1);
    expect(await rulesBroken(linter, PAGE, "import * as geo from '@onway/geo';\nexport const x = geo;\n")).toHaveLength(1);
    expect(await rulesBroken(linter, PAGE, "import { formatCoordinate } from '@onway/geo/dist/src/index.js';\nexport const x = formatCoordinate;\n")).toHaveLength(1);
  });

  it('no molesta a los imports normales de una página', async () => {
    const code =
      "import { useState } from 'react';\nimport { useTranslation } from 'react-i18next';\nimport type { ErrorCode } from '@onway/contracts';\nexport const x = [useState, useTranslation, undefined as ErrorCode | undefined];\n";
    expect(await rulesBroken(baseline, PAGE, code)).toEqual([]);
  });
});
