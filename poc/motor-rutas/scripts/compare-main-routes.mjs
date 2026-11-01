// Main route of every pair in both engines, measured with OnWay's own measurement (D-PoC-01), plus how far each one passes from
// the border pass of `bujaruelo-brecha` (Puerto de Bujaruelo / Port de Boucharo, node/668991342). Writes results/rutas-principales.json.
// Needs both engines up, `pnpm build` and .data/dem.   node poc/motor-rutas/scripts/compare-main-routes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as graphhopper from '../lib/graphhopper.mjs';
import * as valhalla from '../lib/valhalla.mjs';
import { measureLikeOnWay } from '../lib/ours.mjs';
import { distanceToPolylineM } from '../lib/metrics.mjs';

const root = join(import.meta.dirname, '..');
const { pairs } = JSON.parse(readFileSync(join(root, 'cases/pairs.json'), 'utf8'));
const BORDER_PASS = { name: 'Puerto de Bujaruelo / Port de Boucharo', osm: 'node/668991342', lon: -0.06415, lat: 42.70388 };
const round = (value, digits = 1) => Number(value.toFixed(digits));

const out = { date: new Date().toISOString(), borderPass: BORDER_PASS, routes: [] };
for (const pair of pairs) {
  for (const engine of [graphhopper, valhalla]) {
    const { paths } = await engine.route({ url: engine.DEFAULTS.url, from: pair.from, to: pair.to });
    const main = paths[0];
    const metrics = await measureLikeOnWay(main.coords);
    out.routes.push({
      pair: pair.id,
      engine: engine.NAME,
      distanceKm: round(metrics.distanceM / 1000),
      ascentM: Math.round(metrics.ascentM),
      descentM: Math.round(metrics.descentM),
      maxSlopePct: metrics.maxSlopePct,
      mix: Object.fromEntries(Object.entries(main.mix).map(([key, share]) => [key, round(share, 3)])),
      ...(pair.touchesBorder ? { distanceToBorderPassM: Math.round(distanceToPolylineM([BORDER_PASS.lon, BORDER_PASS.lat], main.coords)) } : {}),
    });
  }
}
writeFileSync(join(root, 'results/rutas-principales.json'), `${JSON.stringify(out, null, 2)}\n`);
console.table(out.routes.map((route) => ({ ...route, mix: JSON.stringify(route.mix) })));
