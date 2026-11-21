import { randomBytes } from 'node:crypto';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, type ErrorCode } from '@onway/contracts';
import { haversineM, lengthM } from '@onway/geo';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryRouting } from '../../src/routing/in-memory-routing.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// createRouteVersion with `continueFrom` (issue-pintar-ruta, RF-505, RF-503, D-P4 to D-P8) on real PostGIS: the stored version is
// kept up to the cut, with its road types, and the hand-drawn points follow in straight lines as `offtrail`.
// INV-01 (404 across organizations), INV-04 (the base version does not change), INV-16 (audit), rule 2 (only the coordinator), rule 6.
let app: TestApp;
let fixtures: Fixtures;
const engine = new InMemoryRouting();

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
}
let a: Org;
let b: Org;
const sessions = new Map<string, Session>();
const options = { password: TEST_PASSWORD };

async function build(label: string): Promise<Org> {
  const orgId = await fixtures.organization(label);
  return {
    orgId,
    admin: await fixtures.member(orgId, 'admin', 'active', options),
    coordinator: await fixtures.member(orgId, 'coordinator', 'active', options),
    rescuer: await fixtures.member(orgId, 'rescuer', 'active', options),
  };
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, routing: { provider: engine } });
  a = await build('Continue A');
  b = await build('Continue B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function call(member: Member, method: string, path: string, body?: unknown): Promise<Response> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...withSession(sessions.get(member.userId)!, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
const control = [
  [0.65, 42.6],
  [0.655, 42.603],
  [0.66, 42.606],
];
// Three points to the north-east of the end of the route, where the paths of the network «do not go».
const hand = [
  { lat: 42.6075, lon: 0.6612 },
  { lat: 42.609, lon: 0.6625 },
  { lat: 42.6104, lon: 0.6631 },
];

/** A route whose engine-joined version 1 has two stretches, road then path, or a straight one, unknown. */
async function createBase(snapToPaths: boolean): Promise<{ routeId: string; versionId: string }> {
  const response = await call(a.coordinator, 'POST', '/routes', {
    source: 'drawn',
    name: uniq('Base'),
    geometry: { type: 'LineString', coordinates: control },
    snapToPaths,
  });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}

const continueRoute = (member: Member, routeId: string, body: Record<string, unknown>) => call(member, 'POST', `/routes/${routeId}/versions`, body);

async function versionRow(versionId: string) {
  const [row] = await fixtures.query<{
    geometry: { coordinates: number[][] };
    provenance: string;
    manually_modified: boolean;
    status: string;
    version_number: number;
    distance_m: number;
    ascent_m: number;
    descent_m: number;
  }>(
    `SELECT ST_AsGeoJSON(geom)::json AS geometry, provenance::text, manually_modified, status::text, version_number, distance_m::float8, ascent_m::float8, descent_m::float8
       FROM route_versions WHERE id = $1`,
    [versionId],
  );
  return row!;
}
const segmentsOf = (versionId: string) =>
  fixtures.query<{ road_type: string; distance_m: number; geom: string }>(
    `SELECT road_type::text, distance_m::float8, ST_AsText(geom) AS geom FROM route_segments WHERE version_id = $1 ORDER BY position`,
    [versionId],
  );
const versionsOf = async (routeId: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM route_versions WHERE route_id = $1`, [routeId]))[0]!.n);
const auditOf = (routeId: string) => fixtures.query<{ action: string; detail: Record<string, unknown> }>(`SELECT action, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`, [routeId]);

/** A vertex of the stored base line, about `share` of the way along, as the cut point. */
async function cutOf(versionId: string, share: number) {
  const coordinates = (await versionRow(versionId)).geometry.coordinates;
  const index = Math.round((coordinates.length - 1) * share);
  const [lon, lat] = coordinates[index]!;
  return { index, cutPoint: { lat: lat!, lon: lon! }, kept: coordinates.slice(0, index + 1) };
}

describe('createRouteVersion with continueFrom', () => {
  it('keeps the stored version up to the cut with its road types, follows the hand points in straight lines as offtrail and measures the whole', async () => {
    const base = await createBase(true);
    expect((await segmentsOf(base.versionId)).map((segment) => segment.road_type)).toEqual(['road', 'path']);
    const { index, cutPoint, kept } = await cutOf(base.versionId, 0.8);

    const response = await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId, continueFrom: { cutPoint, points: hand }, note: 'Por el sendero que no está en la red' });
    expect(response.status).toBe(201);
    const created = CreatedRoute.parse(await response.json());
    expect(created).toMatchObject({ routeId: base.routeId, versionNumber: 2, missionRouteId: null });

    const version = await versionRow(created.versionId);
    expect(version).toMatchObject({ provenance: 'edited', manually_modified: true, status: 'draft', version_number: 2 });
    const coordinates = version.geometry.coordinates;
    for (let i = 0; i <= index; i++) {
      expect(coordinates[i]![0]).toBeCloseTo(kept[i]![0]!, 7);
      expect(coordinates[i]![1]).toBeCloseTo(kept[i]![1]!, 7);
    }
    const last = coordinates[coordinates.length - 1]!;
    expect(last[0]).toBeCloseTo(hand[2]!.lon, 7);
    expect(last[1]).toBeCloseTo(hand[2]!.lat, 7);

    const segments = await segmentsOf(created.versionId);
    expect(segments.map((segment) => segment.road_type)).toEqual(['road', 'path', 'offtrail']);
    const keptM = lengthM(kept);
    const handM = lengthM([kept[kept.length - 1]!, ...hand.map(({ lat, lon }) => [lon, lat])]);
    expect(Math.abs(segments[2]!.distance_m - handM)).toBeLessThan(1);
    expect(Math.abs(version.distance_m - (keptM + handM))).toBeLessThan(1);
  });

  it('from a straight drawn version, the kept part stays unclassified and the hand part is offtrail', async () => {
    const base = await createBase(false);
    const { cutPoint } = await cutOf(base.versionId, 0.5);
    const response = await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId, continueFrom: { cutPoint, points: hand } });
    expect(response.status).toBe(201);
    const created = CreatedRoute.parse(await response.json());
    expect((await segmentsOf(created.versionId)).map((segment) => segment.road_type)).toEqual(['unknown', 'offtrail']);
  });

  it('INV-04 and INV-16: the base version stays exactly as it was, and one route_version_created says it was continued and how much it kept', async () => {
    const base = await createBase(true);
    const [before, segmentsBefore] = [await versionRow(base.versionId), await segmentsOf(base.versionId)];
    const { cutPoint, kept } = await cutOf(base.versionId, 0.5);
    const created = CreatedRoute.parse(await (await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId, continueFrom: { cutPoint, points: hand } })).json());

    expect(await versionRow(base.versionId)).toEqual(before);
    expect(await segmentsOf(base.versionId)).toEqual(segmentsBefore);
    const audit = (await auditOf(base.routeId)).filter((row) => row.action === 'route_version_created');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatchObject({ versionNumber: created.versionNumber, baseVersionNumber: 1, continued: true });
    expect(Math.abs((audit[0]!.detail.keptDistanceM as number) - lengthM(kept))).toBeLessThanOrEqual(1);
  });

  it('a cut more than 200 m from the route, or on its first vertex, is refused and nothing is created', async () => {
    const base = await createBase(true);
    const { cutPoint } = await cutOf(base.versionId, 0.5);
    const far = { lat: cutPoint.lat + 0.0027, lon: cutPoint.lon }; // ~300 m to the north
    const { cutPoint: start } = await cutOf(base.versionId, 0);
    expect(haversineM([far.lon, far.lat], [cutPoint.lon, cutPoint.lat])).toBeGreaterThan(290);
    for (const point of [far, start]) {
      const error = await expectError(await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId, continueFrom: { cutPoint: point, points: hand } }), 'VALIDATION_FAILED');
      expect(JSON.stringify(error.details)).toContain('continueFrom.cutPoint');
    }
    expect(await versionsOf(base.routeId)).toBe(1);
  });

  it('refuses the whole geometry and continueFrom together, and neither (rule 6: the kept part never comes from the client)', async () => {
    const base = await createBase(true);
    const { cutPoint } = await cutOf(base.versionId, 0.5);
    const geometry = { type: 'LineString', coordinates: control };
    await expectError(await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId, geometry, continueFrom: { cutPoint, points: hand } }), 'VALIDATION_FAILED');
    await expectError(await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId }), 'VALIDATION_FAILED');
    expect(await versionsOf(base.routeId)).toBe(1);
  });

  it('an archived route is read-only: 409 INVALID_STATE_TRANSITION', async () => {
    const base = await createBase(true);
    const { cutPoint } = await cutOf(base.versionId, 0.5);
    expect((await call(a.coordinator, 'POST', `/routes/${base.routeId}/archive`)).status).toBe(200);
    await expectError(await continueRoute(a.coordinator, base.routeId, { baseVersionId: base.versionId, continueFrom: { cutPoint, points: hand } }), 'INVALID_STATE_TRANSITION');
    expect(await versionsOf(base.routeId)).toBe(1);
  });

  it('the administrator and the rescuer get 403 (rule 2); the coordinator of B gets 404 (INV-01); a base version of another route is 404; nothing changes', async () => {
    const base = await createBase(true);
    const other = await createBase(false);
    const { cutPoint } = await cutOf(base.versionId, 0.5);
    const body = { baseVersionId: base.versionId, continueFrom: { cutPoint, points: hand } };
    const auditBefore = await auditOf(base.routeId);
    for (const member of [a.admin, a.rescuer]) await expectError(await continueRoute(member, base.routeId, body), 'FORBIDDEN');
    await expectError(await continueRoute(b.coordinator, base.routeId, body), 'NOT_FOUND');
    await expectError(await continueRoute(a.coordinator, other.routeId, body), 'NOT_FOUND');
    expect(await versionsOf(base.routeId)).toBe(1);
    expect(await versionsOf(other.routeId)).toBe(1);
    expect(await auditOf(base.routeId)).toEqual(auditBefore);
  });
});
