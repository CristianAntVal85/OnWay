// Valhalla adapter: the same operations as lib/graphhopper.mjs, answered in the PoC's own shape.
import { decodePolyline } from './polyline.mjs';
import { polylineLengthM, resample, sharedShare, squareRing } from './metrics.mjs';

export const NAME = 'valhalla';
export const DEFAULTS = { url: 'http://127.0.0.1:8002', container: 'onway-poc-valhalla-1' };

/** Alternatives asked of the engine itself (Valhalla's `alternates`). */
export const ALTERNATIVES = { alternates: 2 };

/** Walking costing for rescue teams. `max_hiking_difficulty` follows the SAC scale (default 1 would forbid almost every mountain path). */
const PEDESTRIAN = { max_hiking_difficulty: 4, use_tracks: 1, use_hills: 0.5, step_penalty: 0 };

// Valhalla's edge `use` mapped to OnWay's road types (`road`, `track`, `path`); anything else is `unknown`.
const ROAD_USES = new Set([
  'road',
  'ramp',
  'turn_channel',
  'driveway',
  'alley',
  'parking_aisle',
  'emergency_access',
  'drive_through',
  'culdesac',
  'living_street',
  'service_road',
  'rest_area',
  'service_area',
]);
const TRACK_USES = new Set(['track', 'bridleway']);
const PATH_USES = new Set(['path', 'footway', 'steps', 'pedestrian', 'sidewalk', 'cycleway', 'mountain_bike', 'pedestrian_crossing', 'elevator', 'escalator']);
export const roadTypeOfUse = (use) => (ROAD_USES.has(use) ? 'road' : TRACK_USES.has(use) ? 'track' : PATH_USES.has(use) ? 'path' : 'unknown');

async function post(url, path, body) {
  const started = performance.now();
  const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = performance.now() - started;
  const json = await response.json();
  return { ok: response.ok, ms, json };
}

/** Composition by road type from the edges of `trace_attributes` (shares of the length that add up to 1). */
async function mixOf(url, coords) {
  const { ok, json } = await post(url, '/trace_attributes', {
    shape: coords.map(([lon, lat]) => ({ lat, lon })),
    costing: 'pedestrian',
    costing_options: { pedestrian: PEDESTRIAN },
    shape_match: 'map_snap',
    trace_options: { search_radius: 30, gps_accuracy: 10 },
    filters: { attributes: ['edge.length', 'edge.use'], action: 'include' },
  });
  const empty = { road: 0, track: 0, path: 0, unknown: 1 };
  if (!ok || !json.edges?.length) return empty;
  const lengths = { road: 0, track: 0, path: 0, unknown: 0 };
  for (const edge of json.edges) lengths[roadTypeOfUse(edge.use)] += edge.length;
  const total = Object.values(lengths).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(lengths).map(([key, value]) => [key, value / total]));
}

const toPath = async (url, trip) => {
  const coords = decodePolyline(trip.legs[0].shape, 6);
  return {
    distanceM: trip.summary.length * 1000,
    timeS: trip.summary.time,
    // Valhalla's own ascent is not used anywhere: OnWay measures it (D-PoC-01).
    ascentM: 0,
    descentM: 0,
    coords,
    mix: await mixOf(url, coords),
  };
};

/** `customModel` is a fragment merged into the request (see `avoidModel` and `slopeModel`). */
export async function route({ url, from, to, alternatives = ALTERNATIVES, customModel = {} }) {
  const { costingOptions, ...rest } = customModel;
  const { ok, ms, json } = await post(url, '/route', {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: 'pedestrian',
    costing_options: { pedestrian: { ...PEDESTRIAN, ...costingOptions } },
    alternates: alternatives.alternates,
    directions_type: 'none',
    shape_format: 'polyline6',
    ...rest,
  });
  if (!ok) return { ms, paths: [], error: json.error ?? `HTTP ${json.status_code}` };
  const trips = [json.trip, ...(json.alternates ?? []).map((alternate) => alternate.trip)];
  return { ms, paths: await Promise.all(trips.map((trip) => toPath(url, trip))) };
}

/** Zone to avoid (RF-507): Valhalla takes polygons as `exclude_polygons`. */
export const avoidModel = (ring) => ({ exclude_polygons: [ring] });

/**
 * Valhalla has no maximum slope: the only lever is `use_hills` (0 = avoid hills as much as possible). `limitPct` is
 * ignored; the case is still comparable because it measures what the route does, not what the parameter is called.
 */
export const slopeModel = () => ({ costingOptions: { use_hills: 0 } });

/** The other end of the same lever, used as the baseline of the slope case: hills do not matter (`use_hills` 1). */
export const slopeIndifferentModel = () => ({ costingOptions: { use_hills: 1 } });

/** Same strategy as GraphHopper's (README, T5): own alternatives first, then block the middle of the main route. */
export async function proposeRoutes({ url, from, to, minAlternatives = 2, maxShare = 0.7 }) {
  const started = performance.now();
  const native = await route({ url, from, to });
  const paths = native.paths.map((path) => ({ ...path, source: 'native' }));
  // Valhalla also returns near-duplicates: keep only the ones that differ enough from those already kept.
  const kept = [];
  for (const path of paths) if (kept.every((other) => sharedShare(path.coords, other.coords) <= maxShare)) kept.push(path);
  if (kept.length > 0) {
    for (const fraction of [0.5, 0.25, 0.75]) {
      if (kept.length >= minAlternatives) break;
      const middle = resample(kept[0].coords, 10);
      const ring = squareRing(middle[Math.floor(middle.length * fraction)], 100);
      const blocked = await route({ url, from, to, customModel: avoidModel(ring) });
      const candidate = blocked.paths[0];
      if (candidate && kept.every((path) => sharedShare(candidate.coords, path.coords) <= maxShare)) kept.push({ ...candidate, source: 'blocking' });
    }
  }
  return { ms: performance.now() - started, paths: kept, error: native.error };
}

/** Map matching (`snapRoute`): `trace_route` with `map_snap`. */
export async function match({ url, points, accuracyM = 40 }) {
  const { ok, json } = await post(url, '/trace_route', {
    shape: points.map(([lon, lat]) => ({ lat, lon })),
    costing: 'pedestrian',
    costing_options: { pedestrian: PEDESTRIAN },
    shape_match: 'map_snap',
    trace_options: { gps_accuracy: accuracyM, search_radius: 60 },
    directions_type: 'none',
    shape_format: 'polyline6',
  });
  if (!ok) return { coords: [], error: json.error ?? `HTTP ${json.status_code}` };
  const coords = decodePolyline(json.trip.legs[0].shape, 6);
  return polylineLengthM(coords) > 0 ? { coords } : { coords: [], error: 'empty shape' };
}

/** True when the engine says there is no way between the points (not when it failed for any other reason). */
export const isNoRoute = (message) => /No path could be found/i.test(message ?? '');
