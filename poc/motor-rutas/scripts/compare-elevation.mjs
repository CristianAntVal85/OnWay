// Why GraphHopper's ascent differs from OnWay's (README, T5). For each pair it prints the cumulative ascent and descent
// and the net difference between the ends, from GraphHopper's elevation and from OnWay's (GLO-30), with GraphHopper's naive sum
// and with OnWay's algorithm (30 m resampling, median of 3, 3 m threshold). Needs GraphHopper up, `pnpm build` and .data/dem.
//   node poc/motor-rutas/scripts/compare-elevation.mjs [--url http://127.0.0.1:8989]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { route } from '../lib/graphhopper.mjs';

const root = join(import.meta.dirname, '../../..');
const { prepareLine, computeMetrics } = await import(join(root, 'packages/geo/dist/src/index.js'));
const { DemElevationProvider } = await import(join(root, 'apps/api/dist/src/geo/dem-elevation.js'));
const dem = new DemElevationProvider(join(root, 'poc/motor-rutas/.data/dem'));
const { pairs } = JSON.parse(readFileSync(join(root, 'poc/motor-rutas/cases/pairs.json'), 'utf8'));
const urlAt = process.argv.indexOf('--url');
const url = urlAt >= 0 ? process.argv[urlAt + 1] : 'http://127.0.0.1:8989';

/** Sum of every climb and every drop between consecutive vertices, no filter. */
function naiveSum(z) {
  let up = 0;
  let down = 0;
  for (let i = 1; i < z.length; i++) {
    const delta = z[i] - z[i - 1];
    if (delta > 0) up += delta;
    else down -= delta;
  }
  return { up: Math.round(up), down: Math.round(down) };
}

for (const pair of pairs) {
  const { paths } = await route({ url, from: pair.from, to: pair.to });
  const path = paths[0];
  const ghZ = path.coords.map((c) => c[2]);
  console.log(`\n${pair.id}  (${(path.distanceM / 1000).toFixed(1)} km, ${path.coords.length} GraphHopper vertices)`);
  console.log(
    `  GraphHopper reports       : ascent ${Math.round(path.ascentM)}  descent ${Math.round(path.descentM)}  net ${Math.round(ghZ.at(-1) - ghZ[0])}  (start ${Math.round(ghZ[0])} m, end ${Math.round(ghZ.at(-1))} m)`,
  );
  console.log(`  its elevation, naive sum  : ascent ${naiveSum(ghZ).up}  descent ${naiveSum(ghZ).down}`);
  const withOurAlgorithm = computeMetrics(path.coords.map(([lon, lat, z]) => [lon, lat, z])).metrics;
  console.log(`  its elevation, our algo   : ascent ${Math.round(withOurAlgorithm.ascentM)}  descent ${Math.round(withOurAlgorithm.descentM)}`);
  const prepared = prepareLine(path.coords.map(([lon, lat]) => [lon, lat]));
  const z = await dem.elevationsAt(prepared.map(([lon, lat]) => ({ lat, lon })));
  const ours = computeMetrics(prepared.map(([lon, lat], i) => [lon, lat, z[i]])).metrics;
  console.log(
    `  our elevation, our algo   : ascent ${Math.round(ours.ascentM)}  descent ${Math.round(ours.descentM)}  net ${Math.round(z.at(-1) - z[0])}  (start ${Math.round(z[0])} m, end ${Math.round(z.at(-1))} m)`,
  );
  console.log(`  our elevation, naive sum  : ascent ${naiveSum(z).up}  descent ${naiveSum(z).down}`);
}
