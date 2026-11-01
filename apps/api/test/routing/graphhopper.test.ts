import { haversineM, resampleLine, squareRing, type Position2D } from '@onway/geo';
import { beforeAll, describe, expect, it } from 'vitest';
import { GraphHopperRouting } from '../../src/routing/graphhopper-routing.js';
import type { EngineRoute, EngineRoadType, LatLon } from '../../src/routing/routing.js';

// The real engine on the made-up network (data/seed/network.osm): a lattice of paths every 0.01°, a road along the southern
// parallel (lat 42.62), tracks on the two outer meridians and a made-up border on the meridian lon -0.02.
const engine = new GraphHopperRouting({ baseUrl: process.env.ROUTING_URL ?? 'http://127.0.0.1:18989' });

const WEST: LatLon = { lat: 42.63, lon: -0.07 };
const EAST: LatLon = { lat: 42.63, lon: 0.04 };
const TARGET: LatLon = { lat: 42.69, lon: -0.02 };
const BORDER_LON = -0.02;

const lengthM = (coordinates: number[][]): number => coordinates.slice(1).reduce((sum, c, i) => sum + haversineM(coordinates[i]!, c), 0);

function shareByType(route: EngineRoute): Record<EngineRoadType, number> {
  const lengths: Record<EngineRoadType, number> = { road: 0, track: 0, path: 0, unknown: 0 };
  for (const { fromIndex, toIndex, roadType } of route.segments) lengths[roadType] += lengthM(route.coordinates.slice(fromIndex, toIndex + 1));
  const total = Object.values(lengths).reduce((a, b) => a + b, 0);
  return { road: lengths.road / total, track: lengths.track / total, path: lengths.path / total, unknown: lengths.unknown / total };
}

const inside = (route: EngineRoute, ring: Position2D[]): number => {
  const [minLon, minLat] = ring[0]!;
  const [maxLon, maxLat] = ring[2]!;
  return resampleLine(route.coordinates, 5).filter(([lon, lat]) => lon! >= minLon! && lon! <= maxLon! && lat! >= minLat! && lat! <= maxLat!).length;
};

beforeAll(async () => {
  expect(await engine.isAvailable(), 'the routing engine must be up: see the header of vitest.routing.config.ts').toBe(true);
});

describe('GraphHopper on the made-up network', () => {
  it('offers at least two routes that differ, from the first origin to the target', async () => {
    const routes = await engine.alternatives({ from: WEST, to: TARGET, via: [], avoid: [], count: 3 });
    expect(routes.length).toBeGreaterThanOrEqual(2);
    for (const route of routes) {
      expect(haversineM(route.coordinates[0]!, [WEST.lon, WEST.lat])).toBeLessThan(50);
      expect(haversineM(route.coordinates[route.coordinates.length - 1]!, [TARGET.lon, TARGET.lat])).toBeLessThan(50);
    }
    // The routes differ: the first and the others do not follow the same line.
    const [main, ...others] = routes;
    for (const other of others) expect(JSON.stringify(other.coordinates)).not.toBe(JSON.stringify(main!.coordinates));
  });

  it('describes every metre of a route with a road type, none of them unknown, and prefers paths to the road', async () => {
    const [main] = await engine.alternatives({ from: WEST, to: TARGET, via: [], avoid: [], count: 1 });
    const segments = main!.segments;
    expect(segments[0]!.fromIndex).toBe(0);
    expect(segments[segments.length - 1]!.toIndex).toBe(main!.coordinates.length - 1);
    segments.slice(1).forEach((segment, i) => expect(segment.fromIndex).toBe(segments[i]!.toIndex));
    const share = shareByType(main!);
    expect(share.unknown).toBe(0);
    expect(share.path + share.track).toBeGreaterThan(0.9);
  });

  it('crosses the made-up border between an origin on each side (RF-304)', async () => {
    const [main] = await engine.alternatives({ from: WEST, to: EAST, via: [], avoid: [], count: 1 });
    const lons = main!.coordinates.map((c) => c[0]!);
    expect(Math.min(...lons)).toBeLessThan(BORDER_LON);
    expect(Math.max(...lons)).toBeGreaterThan(BORDER_LON);
  });

  it('passes through the intermediate points in order', async () => {
    const via: LatLon = { lat: 42.66, lon: -0.01 };
    const [main] = await engine.alternatives({ from: WEST, to: EAST, via: [via], avoid: [], count: 1 });
    const nearest = main!.coordinates.reduce((best, c, i) => (haversineM(c, [via.lon, via.lat]) < haversineM(main!.coordinates[best]!, [via.lon, via.lat]) ? i : best), 0);
    expect(haversineM(main!.coordinates[nearest]!, [via.lon, via.lat])).toBeLessThan(50);
    expect(nearest).toBeGreaterThan(0);
    expect(nearest).toBeLessThan(main!.coordinates.length - 1);
  });

  it('avoids a zone drawn over the middle of the main route (RF-507)', async () => {
    const [main] = await engine.alternatives({ from: WEST, to: EAST, via: [], avoid: [], count: 1 });
    const middle = resampleLine(main!.coordinates, 10);
    const ring = squareRing(middle[Math.floor(middle.length / 2)]!, 150);
    expect(inside(main!, ring)).toBeGreaterThan(0);
    const [detour] = await engine.alternatives({ from: WEST, to: EAST, via: [], avoid: [ring], count: 1 });
    expect(inside(detour!, ring)).toBe(0);
    expect(lengthM(detour!.coordinates)).toBeGreaterThan(lengthM(main!.coordinates));
  });

  it('says there is no way when the zone to avoid closes the target', async () => {
    const ring = squareRing([TARGET.lon, TARGET.lat], 3000);
    await expect(engine.alternatives({ from: WEST, to: TARGET, via: [], avoid: [ring], count: 2 })).rejects.toMatchObject({ code: 'NO_ROUTE_POSSIBLE' });
  });

  it('says a point outside the network is outside the coverage', async () => {
    await expect(engine.alternatives({ from: { lat: 40.0, lon: 0.0 }, to: TARGET, via: [], avoid: [], count: 1 })).rejects.toMatchObject({ code: 'OUTSIDE_COVERAGE' });
  });

  it('joins hand-placed points following the paths and keeps their order (snapRoute)', async () => {
    // Points 30 m off the lattice along the parallel lat 42.65, from west to east.
    const drawn: LatLon[] = [-0.08, -0.05, -0.02, 0.01, 0.04].map((lon) => ({ lat: 42.65 + 0.0003, lon }));
    const snapped = await engine.snap(drawn);
    expect(snapped.coordinates.length).toBeGreaterThan(drawn.length);
    // Every vertex of the result is on a lattice line (a parallel or a meridian), within 3 m.
    const onLattice = snapped.coordinates.every(([lon, lat]) => {
      const lonOff = Math.abs(((lon! + 0.1) / 0.01) % 1);
      const latOff = Math.abs(((lat! - 42.62) / 0.01) % 1);
      const near = (fraction: number) => Math.min(fraction, 1 - fraction) * 0.01 * 111_000 < 3;
      return near(lonOff) || near(latOff);
    });
    expect(onLattice).toBe(true);
    const lons = snapped.coordinates.map((c) => c[0]!);
    expect(lons[0]!).toBeLessThan(lons[lons.length - 1]!);
    expect(shareByType(snapped).unknown).toBe(0);
  });

  it('answers ROUTING_UNAVAILABLE when the engine does not answer', async () => {
    const down = new GraphHopperRouting({ baseUrl: 'http://127.0.0.1:9', timeoutMs: 2000 });
    await expect(down.alternatives({ from: WEST, to: EAST, via: [], avoid: [], count: 1 })).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
    expect(await down.isAvailable()).toBe(false);
  });

  it('never asks for the altitude of the engine', async () => {
    const [main] = await engine.alternatives({ from: WEST, to: EAST, via: [], avoid: [], count: 1 });
    expect(main!.coordinates.every((c) => c.length === 2)).toBe(true);
  });
});
