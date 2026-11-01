// Pure metrics of the routing PoC: no network, no Docker. Coordinates are [lon, lat] like GeoJSON.
const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (degrees) => (degrees * Math.PI) / 180;

export function haversineM(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function polylineLengthM(coords, from = 0, to = coords.length - 1) {
  let total = 0;
  for (let i = from; i < to; i++) total += haversineM(coords[i], coords[i + 1]);
  return total;
}

/** Points every `stepM` metres along the line (the first one included, the last one always). */
export function resample(coords, stepM) {
  if (coords.length === 0) return [];
  const out = [coords[0]];
  let carried = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const length = haversineM(coords[i], coords[i + 1]);
    let at = stepM - carried;
    while (at <= length) {
      const t = at / length;
      out.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t]);
      at += stepM;
    }
    carried = length - (at - stepM);
  }
  const last = coords[coords.length - 1];
  if (out.length === 1 || haversineM(out[out.length - 1], last) > 1) out.push(last);
  return out;
}

/** Distance from `point` to the polyline, in metres (local equirectangular plane: fine below a few km). */
export function distanceToPolylineM(point, coords) {
  const kLon = Math.cos(toRad(point[1])) * 111_320;
  const kLat = 110_574;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - point[0]) * kLon;
    const ay = (coords[i][1] - point[1]) * kLat;
    const bx = (coords[i + 1][0] - point[0]) * kLon;
    const by = (coords[i + 1][1] - point[1]) * kLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  if (coords.length === 1) best = Math.hypot((coords[0][0] - point[0]) * kLon, (coords[0][1] - point[1]) * kLat);
  return best;
}

/** Share (0..1) of `path`'s length that runs within `toleranceM` of `other` (how much two alternatives share). */
export function sharedShare(path, other, toleranceM = 15, stepM = 25) {
  const samples = resample(path, stepM);
  if (samples.length === 0) return 0;
  const near = samples.filter((point) => distanceToPolylineM(point, other) <= toleranceM).length;
  return near / samples.length;
}

const ROAD = new Set(['MOTORWAY', 'TRUNK', 'PRIMARY', 'SECONDARY', 'TERTIARY', 'RESIDENTIAL', 'UNCLASSIFIED', 'SERVICE', 'LIVING_STREET', 'ROAD']);
const TRACK = new Set(['TRACK', 'BRIDLEWAY']);
const PATH = new Set(['PATH', 'FOOTWAY', 'STEPS', 'PEDESTRIAN', 'CYCLEWAY', 'CORRIDOR', 'PLATFORM']);

/** GraphHopper `road_class` -> the road types of OnWay's `route_segments` (`road`, `track`, `path`; `unknown` is a finding). */
export function roadTypeOf(roadClass) {
  roadClass = String(roadClass).toUpperCase(); // the API answers in lower case ("path", "track")
  if (ROAD.has(roadClass)) return 'road';
  if (TRACK.has(roadClass)) return 'track';
  if (PATH.has(roadClass)) return 'path';
  return 'unknown';
}

/** Composition by road type as shares of the length (they add up to 1). `details` is GraphHopper's [[from, to, value], ...]. */
export function mixFromDetails(coords, details) {
  const lengths = { road: 0, track: 0, path: 0, unknown: 0 };
  for (const [from, to, value] of details) lengths[roadTypeOf(value)] += polylineLengthM(coords, from, to);
  const total = lengths.road + lengths.track + lengths.path + lengths.unknown;
  if (total === 0) return { road: 0, track: 0, path: 0, unknown: 0 };
  return { road: lengths.road / total, track: lengths.track / total, path: lengths.path / total, unknown: lengths.unknown / total };
}

/** Nearest-rank percentile (p in 0..100). */
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** `docker stats` memory ("1.848GiB / 3GiB", "512MiB / 3GiB") -> MiB of the used part. */
export function parseMemUsageMiB(text) {
  const match = /^\s*([\d.]+)\s*(B|KiB|MiB|GiB)\b/.exec(text);
  if (!match) return NaN;
  const value = Number(match[1]);
  return { B: value / 1048576, KiB: value / 1024, MiB: value, GiB: value * 1024 }[match[2]];
}

/** Distance along the polyline (m) of the point of the line closest to `point`; used to check that matched points keep their order. */
export function arcPositionM(point, coords) {
  const kLon = Math.cos(toRad(point[1])) * 111_320;
  const kLat = 110_574;
  let best = { distance: Infinity, arc: 0 };
  let walked = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - point[0]) * kLon;
    const ay = (coords[i][1] - point[1]) * kLat;
    const dx = (coords[i + 1][0] - coords[i][0]) * kLon;
    const dy = (coords[i + 1][1] - coords[i][1]) * kLat;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const distance = Math.hypot(ax + dx * t, ay + dy * t);
    const segment = haversineM(coords[i], coords[i + 1]);
    if (distance < best.distance) best = { distance, arc: walked + segment * t };
    walked += segment;
  }
  return best.arc;
}

/** True when the points, taken in order, never go back along the line by more than `slackM`. */
export function keepsOrder(points, coords, slackM = 30) {
  let last = -Infinity;
  for (const point of points) {
    const arc = arcPositionM(point, coords);
    if (arc < last - slackM) return false;
    last = Math.max(last, arc);
  }
  return true;
}

/** Axis-aligned square of side `2 * halfM` around `center`, as a closed GeoJSON ring. */
export function squareRing(center, halfM) {
  const dLat = halfM / 110_574;
  const dLon = halfM / (Math.cos(toRad(center[1])) * 111_320);
  return [
    [center[0] - dLon, center[1] - dLat],
    [center[0] + dLon, center[1] - dLat],
    [center[0] + dLon, center[1] + dLat],
    [center[0] - dLon, center[1] + dLat],
    [center[0] - dLon, center[1] - dLat],
  ];
}

/** Points of `coords` (resampled every `stepM`) inside the axis-aligned ring made by `squareRing`. */
export function pointsInsideSquare(coords, ring, stepM = 5) {
  const [minX, minY] = ring[0];
  const [maxX, maxY] = ring[2];
  return resample(coords, stepM).filter(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY).length;
}

/** A rough hand drawing of `coords`: a point every `stepM`, each pushed sideways by a fixed pattern (no randomness: the case must repeat). */
export function roughDrawing(coords, stepM = 150, offsetM = 20) {
  return resample(coords, stepM).map(([lon, lat], i) => [lon + ((i % 2 ? 1 : -1) * offsetM) / (Math.cos(toRad(lat)) * 111_320), lat + ((i % 3 ? 1 : -1) * (offsetM * 0.75)) / 110_574]);
}
