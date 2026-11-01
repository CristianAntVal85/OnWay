import { CandidateRoute, ERROR_HTTP, ErrorResponse, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { InMemoryRouting } from '../../src/routing/in-memory-routing.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// snapRoute (H3-T5) on real PostGIS with the in-memory engine. RF-503, rule 6 (the engine's altitude is never used), INV-15.
let app: TestApp;
let fixtures: Fixtures;
let coordinator: Member;
let admin: Member;
let rescuer: Member;
const sessions = new Map<string, Session>();
const synthetic = new SyntheticElevationProvider();
// The engine claims every vertex is at 999 m: the server must not believe it.
const engine = new InMemoryRouting({ falseElevationM: 999 });

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, routing: { provider: engine } });
  const orgId = await fixtures.organization('Snap');
  const options = { password: TEST_PASSWORD };
  coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
  admin = await fixtures.member(orgId, 'admin', 'active', options);
  rescuer = await fixtures.member(orgId, 'rescuer', 'active', options);
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function snap(member: Member, points: unknown): Promise<Response> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  const session = sessions.get(member.userId)!;
  return fetch(`${app.baseUrl}/routes/snap`, { method: 'POST', headers: { ...withSession(session), 'content-type': 'application/json' }, body: JSON.stringify({ points }) });
}

async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
}

const points = [
  { lat: 42.6, lon: 0.65 },
  { lat: 42.603, lon: 0.655 },
  { lat: 42.606, lon: 0.66 },
];
const count = async (table: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);

describe('snapRoute', () => {
  it('joins the points and answers a candidate measured by the server, with the composition the engine reported', async () => {
    engine.setFailure(undefined);
    const response = await snap(coordinator, points);
    expect(response.status).toBe(200);
    const route = CandidateRoute.parse(await response.json());
    expect(route.geometry.coordinates.length).toBeGreaterThan(points.length);
    // The altitude of every vertex is the server's, not the 999 m of the engine (rule 6, INV-15).
    for (const [lon, lat, height] of route.geometry.coordinates) expect(height).toBe(await synthetic.elevationAt({ lat, lon }));
    expect(route.metrics.distanceM).toBeGreaterThan(0);
    // The double reports a road for the first half and a path for the second.
    expect(route.roadMix.map((part) => part.roadType).sort()).toEqual(['path', 'road']);
    const total = route.roadMix.reduce((sum, part) => sum + part.distanceM, 0);
    expect(Math.abs(total - route.metrics.distanceM)).toBeLessThan(1);
    expect(route.offTrailShare).toBe(0);
  });

  it('hands the points to the engine in the order they were given', async () => {
    await snap(coordinator, points);
    expect(engine.calls[engine.calls.length - 1]).toMatchObject({ method: 'snap', points });
  });

  it('saves nothing and audits nothing: it is a preview', async () => {
    const before = [await count('routes'), await count('route_versions'), await count('route_segments'), await count('audit_log')];
    expect((await snap(coordinator, points)).status).toBe(200);
    expect([await count('routes'), await count('route_versions'), await count('route_segments'), await count('audit_log')]).toEqual(before);
  });

  it('is open to the administrator (it reads nothing of anyone) and closed to the rescuer', async () => {
    expect((await snap(admin, points)).status).toBe(200);
    await expectError(await snap(rescuer, points), 'FORBIDDEN');
  });

  it('refuses fewer than two points or more than fifty', async () => {
    await expectError(await snap(coordinator, [points[0]]), 'VALIDATION_FAILED');
    await expectError(
      await snap(
        coordinator,
        Array.from({ length: 51 }, (_, i) => ({ lat: 42.6 + i * 0.0001, lon: 0.65 })),
      ),
      'VALIDATION_FAILED',
    );
  });

  it('shows the engine’s failures with their own code', async () => {
    for (const code of ['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE', 'ROUTING_UNAVAILABLE'] as const) {
      engine.setFailure(code);
      await expectError(await snap(coordinator, points), code);
    }
    engine.setFailure('INTERNAL');
    await expectError(await snap(coordinator, points), 'INTERNAL');
    engine.setFailure(undefined);
  });

  it('answers OUTSIDE_COVERAGE when the server has no altitude for the route', async () => {
    // The in-memory elevation covers 41 to 44.5 N; a route in the south of Spain is outside it.
    const far = [
      { lat: 37.0, lon: -4.0 },
      { lat: 37.01, lon: -4.0 },
    ];
    await expectError(await snap(coordinator, far), 'OUTSIDE_COVERAGE');
  });
});
