import { EARTH_RADIUS_M, haversineM, type Position2D } from './geometry.js';

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Metres per degree of latitude (and of longitude on the equator) on the sphere used by `haversineM`. */
const METRES_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

/** Points every `stepM` metres along the line, the first one included and the last one always. */
export function resampleLine(line: readonly (readonly number[])[], stepM: number): Position2D[] {
  if (line.length === 0) return [];
  const out: Position2D[] = [[line[0]![0]!, line[0]![1]!]];
  if (line.length === 1) return out;
  let carried = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const length = haversineM(a, b);
    let at = stepM - carried;
    while (at <= length) {
      const t = at / length;
      out.push([a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t]);
      at += stepM;
    }
    carried = length - (at - stepM);
  }
  const last = line[line.length - 1]!;
  const end = out[out.length - 1]!;
  if (haversineM(end, last) > 1) out.push([last[0]!, last[1]!]);
  return out;
}

/** Distance in metres from a point to a line, on a local flat plane (fine below a few kilometres). */
export function distanceToLineM(point: readonly number[], line: readonly (readonly number[])[]): number {
  const kLon = Math.cos(toRadians(point[1]!)) * METRES_PER_DEGREE;
  const kLat = METRES_PER_DEGREE;
  if (line.length === 1) return Math.hypot((line[0]![0]! - point[0]!) * kLon, (line[0]![1]! - point[1]!) * kLat);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i]![0]! - point[0]!) * kLon;
    const ay = (line[i]![1]! - point[1]!) * kLat;
    const dx = (line[i + 1]![0]! - line[i]![0]!) * kLon;
    const dy = (line[i + 1]![1]! - line[i]![1]!) * kLat;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}

/** Share (0..1) of `line`'s length that runs within `toleranceM` of `other`: how much two alternatives have in common. */
export function sharedShare(line: readonly (readonly number[])[], other: readonly (readonly number[])[], toleranceM = 15, stepM = 25): number {
  const samples = resampleLine(line, stepM);
  if (samples.length === 0 || other.length === 0) return 0;
  return samples.filter((sample) => distanceToLineM(sample, other) <= toleranceM).length / samples.length;
}

/** Closed ring of a square of side `2 * halfM` around `center`, as GeoJSON wants it (counter-clockwise from the south-west corner). */
export function squareRing(center: readonly number[], halfM: number): Position2D[] {
  const dLat = halfM / METRES_PER_DEGREE;
  const dLon = halfM / (Math.cos(toRadians(center[1]!)) * METRES_PER_DEGREE);
  const [lon, lat] = [center[0]!, center[1]!];
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}
