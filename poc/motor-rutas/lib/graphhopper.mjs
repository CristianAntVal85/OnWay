// GraphHopper adapter: asks /route for alternatives and returns the paths in the PoC's own shape.
import { mixFromDetails, resample, sharedShare, squareRing } from './metrics.mjs';

/** Parameters of the alternative-route search. Tuned in T5/T6; the values used are written next to every result. */
export const ALTERNATIVES = { maxPaths: 3, maxShareFactor: 0.8, maxWeightFactor: 2.5 };

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

const gpx = (points) =>
  `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="onway-poc" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points
    .map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"/>`)
    .join('')}</trkseg></trk></gpx>`;

/** Map matching (`snapRoute`): snaps a rough drawing to the network. GraphHopper takes it as a GPX track. */
export async function match({ url, points, accuracyM = 40 }) {
  const response = await fetch(`${url}/match?profile=mountain&points_encoded=false&gps_accuracy=${accuracyM}`, {
    method: 'POST',
    headers: { 'content-type': 'application/gpx+xml' },
    body: gpx(points),
  });
  const json = await response.json();
  if (!response.ok) return { coords: [], error: json.message ?? `HTTP ${response.status}` };
  return { coords: json.paths[0].points.coordinates };
}

/** Custom model that forbids the edges inside a polygon (RF-507, zones to avoid). */
export const avoidModel = (ring) => ({
  priority: [{ if: 'in_avoid', multiply_by: '0' }],
  areas: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'avoid', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] },
});

/** Custom model that penalises the edges steeper than `limitPct` (up or down). */
export const slopeModel = (limitPct) => ({ priority: [{ if: `max_slope > ${limitPct} || max_slope < -${limitPct}`, multiply_by: '0.05' }] });

/**
 * What the app would do to offer alternatives (RF-501, D-04). GraphHopper's own alternative search first; when it gives
 * fewer than `minAlternatives` (it found none for `ordesa-perdido`, although a detour of the same size exists), a 200 m
 * square is blocked over the middle, then the first and the last quarter of the main route, and the engine is asked again.
 * A detour counts only if it shares at most `maxShare` of its length with every route already kept.
 */
export async function proposeRoutes({ url, from, to, minAlternatives = 2, maxShare = 0.7 }) {
  const started = performance.now();
  const native = await route({ url, from, to });
  const paths = native.paths.map((path) => ({ ...path, source: 'native' }));
  if (paths.length > 0) {
    for (const fraction of [0.5, 0.25, 0.75]) {
      if (paths.length >= minAlternatives) break;
      const middle = resample(paths[0].coords, 10);
      const ring = squareRing(middle[Math.floor(middle.length * fraction)], 100);
      const blocked = await route({ url, from, to, customModel: avoidModel(ring) });
      const candidate = blocked.paths[0];
      if (candidate && paths.every((path) => sharedShare(candidate.coords, path.coords) <= maxShare)) paths.push({ ...candidate, source: 'blocking' });
    }
  }
  return { ms: performance.now() - started, paths, error: native.error };
}
