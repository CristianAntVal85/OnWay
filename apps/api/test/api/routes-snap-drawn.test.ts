import { randomBytes } from 'node:crypto';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryRouting } from '../../src/routing/in-memory-routing.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// createRoute with `snapToPaths` (H3-T9, RF-503, doc 02 §3.6-C): a hand-drawn route whose points the engine joins following the paths.
let app: TestApp;
let fixtures: Fixtures;
let coordinator: Member;
let session: Session;
// The engine claims every vertex is at 999 m: the server must not believe it.
const engine = new InMemoryRouting({ falseElevationM: 999 });

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, routing: { provider: engine } });
  const orgId = await fixtures.organization('Snap drawn');
  coordinator = await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
  session = await mustLogin(app, coordinator.email, TEST_PASSWORD);
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
const points = [
  [0.65, 42.6],
  [0.655, 42.603],
  [0.66, 42.606],
];
const draw = (body: Record<string, unknown>) =>
  fetch(`${app.baseUrl}/routes`, {
    method: 'POST',
    headers: { ...withSession(session), 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'drawn', name: uniq('Dibujada'), geometry: { type: 'LineString', coordinates: points }, ...body }),
  });
async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
}
const count = async (table: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);
const segmentsOf = (routeId: string) =>
  fixtures.query<{ road_type: string; points: number }>(
    `SELECT s.road_type::text, ST_NPoints(s.geom) AS points FROM route_segments s JOIN route_versions v ON v.id = s.version_id WHERE v.route_id = $1 ORDER BY s.position`,
    [routeId],
  );

describe('createRoute with snapToPaths', () => {
  it('joins the control points following the paths, measures the result with the server’s altitude and keeps the composition', async () => {
    engine.setFailure(undefined);
    const response = await draw({ snapToPaths: true });
    expect(response.status).toBe(201);
    const { routeId } = CreatedRoute.parse(await response.json());
    const call = engine.calls[engine.calls.length - 1]!;
    expect(call).toMatchObject({ method: 'snap', points: points.map(([lon, lat]) => ({ lat, lon })) });
    const [version] = await fixtures.query<{ provenance: string; status: string; vertices: number; z999: string }>(
      `SELECT provenance::text, status::text, ST_NPoints(geom) AS vertices, (SELECT count(*) FROM (SELECT (ST_DumpPoints(geom)).geom AS p) d WHERE ST_Z(p) = 999)::text AS z999 FROM route_versions WHERE route_id = $1`,
      [routeId],
    );
    expect(version).toMatchObject({ provenance: 'drawn', status: 'draft', z999: '0' });
    expect(version!.vertices).toBeGreaterThan(points.length);
    expect((await segmentsOf(routeId)).map((segment) => segment.road_type)).toEqual(['road', 'path']);
    const [audit] = await fixtures.query<{ detail: { snapToPaths?: boolean; source?: string } }>(`SELECT detail FROM audit_log WHERE entity_id = $1`, [routeId]);
    expect(audit!.detail).toMatchObject({ source: 'drawn', snapToPaths: true });
  });

  it('without it, saves the line as it came and leaves the route unclassified, without asking the engine', async () => {
    const calls = engine.calls.length;
    const response = await draw({});
    expect(response.status).toBe(201);
    const { routeId } = CreatedRoute.parse(await response.json());
    expect(engine.calls.length).toBe(calls);
    expect((await segmentsOf(routeId)).map((segment) => segment.road_type)).toEqual(['unknown']);
  });

  it('refuses more than fifty control points, and saves nothing', async () => {
    const many = Array.from({ length: 51 }, (_, i) => [0.65 + i * 0.001, 42.6 + i * 0.0005]);
    const before = [await count('routes'), await count('route_versions'), await count('audit_log')];
    await expectError(await draw({ snapToPaths: true, geometry: { type: 'LineString', coordinates: many } }), 'VALIDATION_FAILED');
    expect([await count('routes'), await count('route_versions'), await count('audit_log')]).toEqual(before);
  });

  it('shows the engine’s failure with its own code and saves nothing', async () => {
    const before = [await count('routes'), await count('route_versions'), await count('audit_log')];
    for (const code of ['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE', 'ROUTING_UNAVAILABLE'] as const) {
      engine.setFailure(code);
      await expectError(await draw({ snapToPaths: true }), code);
    }
    engine.setFailure(undefined);
    expect([await count('routes'), await count('route_versions'), await count('audit_log')]).toEqual(before);
  });

  it('is not a field of an imported route', async () => {
    const response = await fetch(`${app.baseUrl}/routes`, {
      method: 'POST',
      headers: { ...withSession(session), 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'import', name: uniq('x'), fileId: '00000000-0000-4000-8000-000000000000', snapToPaths: true }),
    });
    await expectError(response, 'VALIDATION_FAILED');
  });
});
