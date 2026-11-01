import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/common/domain-error.js';
import { GraphHopperRouting, mapEngineError, roadTypeOfClass } from '../../src/routing/graphhopper-routing.js';
import { InMemoryRouting } from '../../src/routing/in-memory-routing.js';

const A = { lat: 42.63, lon: -0.07 };
const B = { lat: 42.63, lon: 0.04 };

/** A straight east-west line at `lat`, 12 vertices, with the given road classes by index range. */
const path = (lat: number, details: [number, number, string][] = [[0, 11, 'path']]) => ({
  points: { coordinates: Array.from({ length: 12 }, (_, i) => [-0.07 + (0.11 * i) / 11, lat]) },
  details: { road_class: details },
});

/** The same straight line as `path`, `factor` times as long (to the east). */
const stretched = (lat: number, factor: number) => ({
  points: { coordinates: Array.from({ length: 12 }, (_, i) => [-0.07 + (0.11 * factor * i) / 11, lat]) },
  details: { road_class: [[0, 11, 'path']] },
});

type Body = {
  points: number[][];
  profile: string;
  algorithm?: string;
  elevation: boolean;
  custom_model?: { priority: { if: string }[]; areas: { features: { id: string }[] } };
  [key: string]: unknown;
};

/** A fake engine: `answer` receives the parsed body and returns the paths (or an error response). */
function engine(answer: (body: Body, call: number) => { paths?: unknown[]; status?: number; message?: string }) {
  const bodies: Body[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const { paths, status = 200, message } = answer(body, bodies.length);
    return new Response(JSON.stringify(status === 200 ? { paths } : { message }), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, bodies };
}
const provider = (fetchFn: typeof fetch) => new GraphHopperRouting({ baseUrl: 'http://routing:8989/', fetchFn });
const request = { from: A, to: B, via: [], avoid: [], count: 2 };

describe('mapEngineError', () => {
  it('maps the engine answers to the codes of the API', () => {
    expect((mapEngineError({ message: 'Connection between locations not found' }, false) as DomainError).code).toBe('NO_ROUTE_POSSIBLE');
    expect((mapEngineError({ message: 'Point 0 is out of bounds: 40,0' }, false) as DomainError).code).toBe('OUTSIDE_COVERAGE');
    expect((mapEngineError({ message: 'Cannot find point 1: 42.6, 0.6' }, false) as DomainError).code).toBe('OUTSIDE_COVERAGE');
    expect((mapEngineError({ hints: [{ details: 'com.graphhopper.util.exceptions.ConnectionNotFoundException' }] }, false) as DomainError).code).toBe('NO_ROUTE_POSSIBLE');
  });
  it('says a point it cannot place is a blocked route when a zone to avoid was asked for', () => {
    expect((mapEngineError({ message: 'Cannot find point 1: 42.6, 0.6' }, true) as DomainError).code).toBe('NO_ROUTE_POSSIBLE');
  });
  it('does not turn an unknown rejection into a domain answer', () => {
    const error = mapEngineError({ message: 'Unknown profile "x"' }, false);
    expect(error).not.toBeInstanceOf(DomainError);
    expect(error.message).toContain('Unknown profile');
  });
});

describe('roadTypeOfClass', () => {
  it('maps road classes to road, track and path, and anything else to unknown', () => {
    expect(['secondary', 'service', 'track', 'bridleway', 'path', 'footway', 'steps', 'other'].map(roadTypeOfClass)).toEqual(['road', 'road', 'track', 'track', 'path', 'path', 'path', 'unknown']);
  });
});

describe('GraphHopperRouting', () => {
  it('asks for the mountain profile without the engine altitude and with the road classes', async () => {
    const { fetchFn, bodies } = engine(() => ({
      paths: [
        path(42.63, [
          [0, 5, 'unclassified'],
          [5, 11, 'path'],
        ]),
      ],
    }));
    const routes = await provider(fetchFn).alternatives({ ...request, count: 1 });
    expect(bodies[0]).toMatchObject({
      profile: 'mountain',
      elevation: false,
      points_encoded: false,
      points: [
        [-0.07, 42.63],
        [0.04, 42.63],
      ],
      details: ['road_class'],
    });
    expect(bodies[0]!.algorithm).toBeUndefined();
    expect(routes[0]!.segments).toEqual([
      { fromIndex: 0, toIndex: 5, roadType: 'road' },
      { fromIndex: 5, toIndex: 11, roadType: 'path' },
    ]);
  });

  it('uses the alternative search of the engine for two points and keeps only the routes that differ enough', async () => {
    const { fetchFn, bodies } = engine(() => ({ paths: [path(42.63), path(42.63), path(42.64)] }));
    const routes = await provider(fetchFn).alternatives({ ...request, count: 3 });
    expect(bodies[0]).toMatchObject({ algorithm: 'alternative_route', 'alternative_route.max_paths': 3 });
    expect(routes).toHaveLength(2); // the second path is the first again: dropped
  });

  it('does not offer a route more than 50 % longer than the main one (it is another route, not a way round), but offers one that is exactly that much', async () => {
    const tooLong = engine((body) => ({ paths: [body.custom_model ? stretched(42.65, 1.6) : path(42.63)] }));
    expect(await provider(tooLong.fetchFn).alternatives(request)).toHaveLength(1);
    const native = engine(() => ({ paths: [path(42.63), stretched(42.65, 1.6)] }));
    expect(await provider(native.fetchFn).alternatives(request)).toHaveLength(1);
    const allowed = engine(() => ({ paths: [path(42.63), stretched(42.65, 1.49)] }));
    expect(await provider(allowed.fetchFn).alternatives(request)).toHaveLength(2);
  });

  it('blocks 200 m in the middle of the main route when the engine finds fewer routes than asked', async () => {
    const { fetchFn, bodies } = engine((body) => ({ paths: [body.custom_model ? path(42.65) : path(42.63)] }));
    const routes = await provider(fetchFn).alternatives(request);
    expect(routes).toHaveLength(2);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.custom_model!.priority[0]!.if).toBe('in_avoid0');
    expect(bodies[1]!.custom_model!.areas.features).toHaveLength(1);
  });

  it('adds the blocked square to the zones the user asked to avoid', async () => {
    const zone: [number, number][] = [
      [0, 42.6],
      [0.001, 42.6],
      [0.001, 42.601],
      [0, 42.601],
      [0, 42.6],
    ];
    const { fetchFn, bodies } = engine((body) => ({ paths: [body.custom_model!.areas.features.length > 1 ? path(42.66) : path(42.63)] }));
    await provider(fetchFn).alternatives({ ...request, avoid: [zone] });
    expect(bodies[0]!.custom_model!.priority[0]!.if).toBe('in_avoid0');
    expect(bodies[1]!.custom_model!.priority[0]!.if).toBe('in_avoid0 || in_avoid1');
  });

  it('does not use the alternative search with intermediate points and still offers a detour', async () => {
    const { fetchFn, bodies } = engine((body) => ({ paths: [body.custom_model ? path(42.65) : path(42.63)] }));
    const routes = await provider(fetchFn).alternatives({ ...request, via: [{ lat: 42.631, lon: -0.01 }] });
    expect(bodies[0]!.algorithm).toBeUndefined();
    expect(bodies[0]!.points).toHaveLength(3);
    expect(routes).toHaveLength(2);
  });

  it('skips a detour that cannot exist, and a detour that is the same route', async () => {
    const noDetour = engine((body) => (body.custom_model ? { status: 400, message: 'Connection between locations not found' } : { paths: [path(42.63)] }));
    expect(await provider(noDetour.fetchFn).alternatives(request)).toHaveLength(1);
    const same = engine(() => ({ paths: [path(42.63)] }));
    expect(await provider(same.fetchFn).alternatives(request)).toHaveLength(1);
  });

  it('fails when the very first route cannot be found, and when the engine does not answer', async () => {
    const none = engine(() => ({ status: 400, message: 'Connection between locations not found' }));
    await expect(provider(none.fetchFn).alternatives(request)).rejects.toMatchObject({ code: 'NO_ROUTE_POSSIBLE' });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(provider(down).alternatives(request)).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
    expect(await provider(down).isAvailable()).toBe(false);
    const failing = engine(() => ({ status: 503, message: 'busy' }));
    await expect(provider(failing.fetchFn).snap([A, B])).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
  });

  it('does not hide an unavailable engine behind a missing detour', async () => {
    const { fetchFn } = engine((body) => (body.custom_model ? { status: 503, message: 'busy' } : { paths: [path(42.63)] }));
    await expect(provider(fetchFn).alternatives(request)).rejects.toMatchObject({ code: 'ROUTING_UNAVAILABLE' });
  });

  it('snaps by routing through all the points, in order', async () => {
    const { fetchFn, bodies } = engine(() => ({ paths: [path(42.63)] }));
    const route = await provider(fetchFn).snap([A, { lat: 42.635, lon: -0.02 }, B]);
    expect(bodies[0]!.points).toEqual([
      [-0.07, 42.63],
      [-0.02, 42.635],
      [0.04, 42.63],
    ]);
    expect(route.coordinates).toHaveLength(12);
  });
});

describe('InMemoryRouting', () => {
  it('returns distinct routes, records its calls and carries the false altitude the server must ignore', async () => {
    const engine = new InMemoryRouting({ falseElevationM: 999 });
    const routes = await engine.alternatives({ ...request, count: 3 });
    expect(routes).toHaveLength(3);
    expect(routes[0]!.coordinates[0]).toEqual([-0.07, 42.63, 999]);
    expect(new Set(routes.map((route) => route.coordinates[Math.floor(route.coordinates.length / 2)]![1])).size).toBe(3);
    expect(engine.calls).toHaveLength(1);
  });
  it('fails on demand with the code of the API', async () => {
    const engine = new InMemoryRouting({ failWith: 'NO_ROUTE_POSSIBLE' });
    await expect(engine.alternatives(request)).rejects.toMatchObject({ code: 'NO_ROUTE_POSSIBLE' });
    engine.setFailure('INTERNAL');
    await expect(engine.snap([A, B])).rejects.not.toBeInstanceOf(DomainError);
    expect(await new InMemoryRouting({ failWith: 'ROUTING_UNAVAILABLE' }).isAvailable()).toBe(false);
  });
});
