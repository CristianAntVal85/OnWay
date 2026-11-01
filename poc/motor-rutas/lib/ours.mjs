// OnWay's own measurement (D-PoC-01, rule 6): the PoC judges slopes and ascent exactly as the server would, with the
// same code it runs (`prepareLine` and `computeMetrics` of @onway/geo, and the Copernicus GLO-30 reader of apps/api).
// It imports the built output, so `pnpm build` must have run, and the DEM tiles must be in .data/dem (scripts/fetch-dem.sh).
import { join } from 'node:path';

const root = join(import.meta.dirname, '../../..');
const demDirectory = join(root, 'poc/motor-rutas/.data/dem');

async function load(path) {
  try {
    return await import(join(root, path));
  } catch (error) {
    throw new Error(`${path} is missing: run "pnpm build" first (${error.code ?? error.message})`, { cause: error });
  }
}

const { prepareLine, computeMetrics } = await load('packages/geo/dist/src/index.js');
const { DemElevationProvider } = await load('apps/api/dist/src/geo/dem-elevation.js');
const dem = new DemElevationProvider(demDirectory);

/** Metrics of a `[lon, lat, ...]` line the way the server computes them: distance, ascent, descent and max slope (%). */
export async function measureLikeOnWay(coords) {
  const prepared = prepareLine(coords.map(([lon, lat]) => [lon, lat]));
  const heights = await dem.elevationsAt(prepared.map(([lon, lat]) => ({ lat, lon })));
  if (heights.some((height) => height === null)) throw new Error('outside the DEM tiles in .data/dem');
  return computeMetrics(prepared.map(([lon, lat], i) => [lon, lat, heights[i]])).metrics;
}
