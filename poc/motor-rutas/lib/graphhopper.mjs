// GraphHopper adapter: asks /route for alternatives and returns the paths in the PoC's own shape.
import { mixFromDetails } from './metrics.mjs';

/** Parameters of the alternative-route search. Tuned in T5/T6; the values used are written next to every result. */
export const ALTERNATIVES = { maxPaths: 3, maxShareFactor: 0.7, maxWeightFactor: 1.6 };

export const NAME = 'graphhopper';

export async function route({ url, from, to, alternatives = ALTERNATIVES, customModel }) {
  const body = {
    points: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
    profile: 'mountain',
    algorithm: 'alternative_route',
    'alternative_route.max_paths': alternatives.maxPaths,
    'alternative_route.max_share_factor': alternatives.maxShareFactor,
    'alternative_route.max_weight_factor': alternatives.maxWeightFactor,
    points_encoded: false,
    elevation: true,
    instructions: false,
    details: ['road_class', 'track_type', 'hike_rating'],
    ...(customModel ? { custom_model: customModel } : {}),
  };
  const started = performance.now();
  const response = await fetch(`${url}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = performance.now() - started;
  const json = await response.json();
  if (!response.ok) return { ms, paths: [], error: json.message ?? `HTTP ${response.status}` };
  const paths = json.paths.map((path) => {
    const coords = path.points.coordinates;
    return {
      distanceM: path.distance,
      timeS: path.time / 1000,
      ascentM: path.ascend ?? 0,
      descentM: path.descend ?? 0,
      coords,
      mix: mixFromDetails(coords, path.details.road_class),
    };
  });
  return { ms, paths };
}
