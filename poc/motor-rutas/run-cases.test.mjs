import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graphhopper from './lib/graphhopper.mjs';
import * as valhalla from './lib/valhalla.mjs';
import { checkPairs, checkProbe, evaluatePair } from './run-cases.mjs';

const point = (name) => ({ name, lat: 42.6, lon: 0.6, osm: 'node/1' });
const pair = (id) => ({ id, from: point('a'), trailhead: point('a'), to: point('b'), touchesBorder: false });
const thresholds = { minAlternatives: 2, maxSharedShare: 0.7, minTrailShare: 0.9, p95Seconds: 5, peakMemoryMb: 2048 };

test('checkPairs asks for the expected number of valid pairs', () => {
  assert.deepEqual(checkPairs({ thresholds, pairs: [pair('x')] }, 1), []);
  assert.deepEqual(checkPairs({ thresholds, pairs: [pair('x')] }), ['there must be exactly 3 pairs']);
  assert.ok(checkPairs({ thresholds, pairs: [{ ...pair('x'), to: { name: 'b', lat: 10, lon: 0.6, osm: 'node/1' } }] }, 1).some((problem) => problem.includes('to is not a valid point')));
  assert.ok(checkPairs({ thresholds: {}, pairs: [pair('x')] }, 1).some((problem) => problem.includes('thresholds.minAlternatives')));
  assert.ok(checkPairs({ thresholds, pairs: [pair('x'), pair('x')] }, 2).some((problem) => problem.includes('repeated')));
});

test('checkProbe validates the points, the limit and the ratio', () => {
  const probe = { from: point('a'), to: point('b'), limitPct: 25, maxSlopeRatio: 0.7 };
  assert.deepEqual(checkProbe(probe), []);
  assert.ok(checkProbe({ ...probe, maxSlopeRatio: 1.2 }).length > 0);
  assert.ok(checkProbe({ ...probe, limitPct: 0 }).length > 0);
});

const route = (lonEnd, mix, source) => ({
  coords: Array.from({ length: 11 }, (_, i) => [0.6 + (lonEnd - 0.6) * (i / 10), 42.6]),
  mix: { road: 0, track: 0, path: 0, unknown: 0, ...mix },
  source,
});

test('evaluatePair: two distinct routes on trails pass criteria 1, 2, 4 and 8', () => {
  const main = route(0.7, { path: 1 }, 'native');
  const other = { ...route(0.7, { track: 1 }, 'blocking'), coords: main.coords.map(([lon]) => [lon, 42.62]) };
  const result = evaluatePair([main, other], [0.01, 0.02, 0.03], thresholds);
  assert.deepEqual(
    [1, 2, 4, 8].map((c) => result[c].pass),
    [true, true, true, true],
  );
  assert.deepEqual(result[1].value.sources, ['native', 'blocking']);
});

test('evaluatePair: one route, a road-heavy route or an unknown road type fail', () => {
  const result = evaluatePair([route(0.7, { road: 0.5, path: 0.45, unknown: 0.05 }, 'native')], [0.01], thresholds);
  assert.deepEqual(
    [1, 2, 8].map((c) => result[c].pass),
    [false, false, false],
  );
});

test('evaluatePair: two routes that overlap too much fail criterion 1', () => {
  const main = route(0.7, { path: 1 }, 'native');
  const result = evaluatePair([main, { ...main, source: 'blocking' }], [0.01], thresholds);
  assert.equal(result[1].pass, false);
});

test('only a clean "no way" answer counts as no route', () => {
  assert.equal(graphhopper.isNoRoute('Connection between locations not found'), true);
  assert.equal(graphhopper.isNoRoute('Internal server error'), false);
  assert.equal(graphhopper.isNoRoute(undefined), false);
  assert.equal(valhalla.isNoRoute('No path could be found for input'), true);
  assert.equal(valhalla.isNoRoute('Failed to parse json request'), false);
});

test('Valhalla edge uses map to OnWay road types', () => {
  assert.equal(valhalla.roadTypeOfUse('road'), 'road');
  assert.equal(valhalla.roadTypeOfUse('service_road'), 'road');
  assert.equal(valhalla.roadTypeOfUse('track'), 'track');
  assert.equal(valhalla.roadTypeOfUse('path'), 'path');
  assert.equal(valhalla.roadTypeOfUse('footway'), 'path');
  assert.equal(valhalla.roadTypeOfUse('ferry'), 'unknown');
});
