import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  arcPositionM,
  distanceToPolylineM,
  haversineM,
  mixFromDetails,
  parseMemUsageMiB,
  percentile,
  pointsInsideSquare,
  polylineLengthM,
  resample,
  keepsOrder,
  roughDrawing,
  squareRing,
  roadTypeOf,
  sharedShare,
} from './metrics.mjs';

// A straight line due east along 42.6 N: 0.01 degrees of longitude are ~822 m there.
const line = (from, to, steps) => Array.from({ length: steps + 1 }, (_, i) => [from + ((to - from) * i) / steps, 42.6]);

test('haversine: one degree of latitude is ~111.2 km', () => {
  assert.ok(Math.abs(haversineM([0, 42], [0, 43]) - 111_195) < 100);
});

test('resample: points are ~step apart and the end is kept', () => {
  const coords = line(0.6, 0.7, 4);
  const points = resample(coords, 250);
  assert.deepEqual(points[0], coords[0]);
  assert.deepEqual(points[points.length - 1], coords[4]);
  const length = polylineLengthM(coords);
  assert.ok(Math.abs(points.length - 1 - Math.ceil(length / 250)) <= 1);
});

test('distanceToPolylineM: 0 on the line, ~111 m for 0.001 degrees of latitude', () => {
  const coords = line(0.6, 0.7, 4);
  assert.ok(distanceToPolylineM([0.65, 42.6], coords) < 0.01);
  assert.ok(Math.abs(distanceToPolylineM([0.65, 42.601], coords) - 110.6) < 1);
});

test('sharedShare: identical paths share all, disjoint ones none, half-overlapping about half', () => {
  const main = line(0.6, 0.7, 10);
  assert.equal(sharedShare(main, main), 1);
  assert.equal(
    sharedShare(
      line(0.6, 0.7, 10).map(([lon]) => [lon, 42.62]),
      main,
    ),
    0,
  );
  // First half on the main line, then 55 m to the side (beyond the 15 m tolerance): ~47 % shared.
  const half = [...line(0.6, 0.65, 5), [0.65, 42.6005], [0.7, 42.6005]];
  const share = sharedShare(half, main, 15, 25);
  assert.ok(share > 0.4 && share < 0.6, String(share));
});

test('roadTypeOf maps GraphHopper classes to road, track and path; anything else is unknown', () => {
  assert.equal(roadTypeOf('SECONDARY'), 'road');
  assert.equal(roadTypeOf('TRACK'), 'track');
  assert.equal(roadTypeOf('PATH'), 'path');
  assert.equal(roadTypeOf('FOOTWAY'), 'path');
  assert.equal(roadTypeOf('path'), 'path'); // GraphHopper answers in lower case
  assert.equal(roadTypeOf('OTHER'), 'unknown');
});

test('mixFromDetails: shares add up to 1', () => {
  const coords = line(0.6, 0.7, 4);
  const mix = mixFromDetails(coords, [
    [0, 1, 'SERVICE'],
    [1, 3, 'PATH'],
    [3, 4, 'OTHER'],
  ]);
  assert.ok(Math.abs(mix.road + mix.track + mix.path + mix.unknown - 1) < 1e-9);
  assert.ok(Math.abs(mix.road - 0.25) < 1e-6 && Math.abs(mix.path - 0.5) < 1e-6 && Math.abs(mix.unknown - 0.25) < 1e-6);
});

test('percentile is nearest-rank', () => {
  const values = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10];
  assert.equal(percentile(values, 95), 10);
  assert.equal(percentile(values, 50), 5);
});

test('parseMemUsageMiB reads docker stats', () => {
  assert.equal(parseMemUsageMiB('512MiB / 3GiB'), 512);
  assert.equal(parseMemUsageMiB('1.5GiB / 3GiB'), 1536);
  assert.ok(Number.isNaN(parseMemUsageMiB('--')));
});

test('arcPositionM and keepsOrder: points along a line keep their order, reversed ones do not', () => {
  const coords = line(0.6, 0.7, 10);
  const arc = arcPositionM([0.65, 42.6003], coords);
  assert.ok(Math.abs(arc - polylineLengthM(coords) / 2) < 5);
  const points = [0.62, 0.64, 0.66, 0.68].map((lon) => [lon, 42.6002]);
  assert.equal(keepsOrder(points, coords), true);
  assert.equal(keepsOrder([...points].reverse(), coords), false);
});

test('squareRing and pointsInsideSquare: a 100 m half-side square catches ~200 m of a line through its centre', () => {
  const coords = line(0.6, 0.7, 10);
  const ring = squareRing([0.65, 42.6], 100);
  const inside = pointsInsideSquare(coords, ring, 5);
  assert.ok(inside >= 38 && inside <= 42, String(inside));
  assert.equal(pointsInsideSquare(line(0.6, 0.62, 2), ring, 5), 0);
});

test('roughDrawing is repeatable and stays within ~25 m of the line (20 m along, 15 m across)', () => {
  const coords = line(0.6, 0.7, 10);
  const first = roughDrawing(coords);
  assert.deepEqual(first, roughDrawing(coords));
  for (const point of first) assert.ok(distanceToPolylineM(point, coords) <= 26);
});
