import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, FileRef, MissionDetail, RouteDetail, RouteVersion, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// createRoute, createRouteVersion, deriveRoute, validateRouteVersion and archiveRoute (H2-T5) on real PostGIS.
// INV-01 (404 across organizations), INV-04 (versions do not change), INV-07 (archive vs open missions), INV-15 (provenance), INV-16 (audit).
let app: TestApp;
let fixtures: Fixtures;
const storage = new InMemoryFileStorage();
const synthetic = new SyntheticElevationProvider();

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  secondCoordinator: Member;
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
    secondCoordinator: await fixtures.member(orgId, 'coordinator', 'active', options),
    rescuer: await fixtures.member(orgId, 'rescuer', 'active', options),
  };
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, files: { storage } });
  a = await build('Org A');
  b = await build('Org B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function sessionOf(member: Member): Promise<Session> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  return sessions.get(member.userId)!;
}

async function call(member: Member, method: string, path: string, body?: unknown): Promise<Response> {
  const session = await sessionOf(member);
  return fetch(`${app.baseUrl}${path}`, {
    method,
    headers: { ...withSession(session, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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
const line = (shift = 0, count = 6) => ({
  type: 'LineString' as const,
  coordinates: Array.from({ length: count }, (_, i) => [0.65 + i * 0.0012 + shift, 42.6 + i * 0.0009 + shift] as [number, number]),
});
const fixtureFile = (name: string) => readFile(new URL(`../../../../packages/geo/test/fixtures/${name}`, import.meta.url), 'utf8');

async function upload(member: Member, content: string): Promise<string> {
  const form = new FormData();
  form.set('purpose', 'route_import');
  form.set('file', new Blob([content], { type: 'application/gpx+xml' }), 'track.gpx');
  const response = await fetch(`${app.baseUrl}/files`, { method: 'POST', headers: withSession(await sessionOf(member)), body: form });
  expect(response.status).toBe(201);
  return FileRef.parse(await response.json()).id;
}

async function createDrawn(member: Member, overrides: Record<string, unknown> = {}) {
  const response = await call(member, 'POST', '/routes', { source: 'drawn', name: uniq('Route'), geometry: line(), ...overrides });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
const auditOf = (routeId: string) =>
  fixtures.query<{ action: string; actor_user_id: string; organization_id: string; entity_type: string; detail: Record<string, unknown> }>(
    `SELECT action, actor_user_id, organization_id, entity_type, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`,
    [routeId],
  );
const count = async (table: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);
interface VersionRow {
  version_number: number;
  status: string;
  provenance: string;
  manually_modified: boolean;
  source_file_id: string | null;
  note: string | null;
  distance_m: string;
  wkt: string;
  validated_by: string | null;
  created_by: string;
}
const versionsOf = (routeId: string) =>
  fixtures.query<VersionRow>(
    `SELECT version_number, status::text AS status, provenance::text AS provenance, manually_modified, source_file_id, note, distance_m::text AS distance_m, ST_AsText(geom) AS wkt, validated_by, created_by
       FROM route_versions WHERE route_id = $1 ORDER BY version_number`,
    [routeId],
  );
const routeRow = async (routeId: string) =>
  (
    await fixtures.query<{
      status: string;
      latest_version_id: string | null;
      latest_validated_version_id: string | null;
      derived_from_route_id: string | null;
      derived_from_version_id: string | null;
      name: string;
      organization_id: string;
    }>(`SELECT status::text AS status, latest_version_id, latest_validated_version_id, derived_from_route_id, derived_from_version_id, name, organization_id FROM routes WHERE id = $1`, [routeId])
  )[0]!;

describe('createRoute (RF-505, RF-510; INV-15)', () => {
  it('drawn: version 1 as a Draft with provenance `drawn`, measured by the server, one `unknown` segment, `latest_version_id` set', async () => {
    const name = uniq('Drawn');
    const created = await createDrawn(a.coordinator, { name, note: 'first outing' });
    expect(created).toMatchObject({ versionNumber: 1, missionRouteId: null });

    expect(await versionsOf(created.routeId)).toMatchObject([
      { version_number: 1, status: 'draft', provenance: 'drawn', manually_modified: false, source_file_id: null, note: 'first outing', created_by: a.coordinator.userId },
    ]);
    expect(await routeRow(created.routeId)).toMatchObject({
      name,
      status: 'active',
      latest_version_id: created.versionId,
      latest_validated_version_id: null,
      derived_from_route_id: null,
      organization_id: a.orgId,
    });

    const [segment] = await fixtures.query<{ n: string; road_type: string; distance_m: string; v_distance: string; same_geom: boolean }>(
      `SELECT count(*) OVER () AS n, s.road_type::text AS road_type, s.distance_m::text AS distance_m, v.distance_m::text AS v_distance, ST_Equals(s.geom, v.geom) AS same_geom
         FROM route_segments s JOIN route_versions v ON v.id = s.version_id WHERE v.route_id = $1`,
      [created.routeId],
    );
    expect(segment).toMatchObject({ n: '1', road_type: 'unknown', same_geom: true });
    expect(segment!.distance_m).toBe(segment!.v_distance);

    const [z] = await fixtures.query<{ type: string; dims: number; points: number; srid: number }>(
      `SELECT GeometryType(geom) AS type, ST_NDims(geom) AS dims, ST_NPoints(geom) AS points, ST_SRID(geom) AS srid FROM route_versions WHERE id = $1`,
      [created.versionId],
    );
    expect(z).toMatchObject({ type: 'LINESTRING', dims: 3, srid: 4326 });
    expect(z!.points).toBeGreaterThan(6);
  });

  it('ignores the altitudes and metrics the client sends (INV-15, RN-10): a drawn line with 999 m everywhere is stored with the server’s altitudes', async () => {
    const faked = { ...line(), coordinates: line().coordinates.map(([lon, lat]) => [lon, lat, 999]) };
    const created = await createDrawn(a.coordinator, { geometry: faked });
    const rows = await fixtures.query<{ z: number }>(`SELECT ST_Z((dp).geom) AS z FROM (SELECT ST_DumpPoints(geom) AS dp FROM route_versions WHERE id = $1) t`, [created.versionId]);
    expect(rows.length).toBeGreaterThan(6);
    expect(rows.some((row) => row.z === 999)).toBe(false);
    const [first] = line().coordinates;
    expect(rows[0]!.z).toBe(await synthetic.elevationAt({ lon: first![0], lat: first![1] }));
  });

  it('accepts the largest line the contract allows (20 000 vertices) and measures it', async () => {
    const wander = Array.from({ length: 20_000 }, (_, i) => [-0.9 + i * 0.0001, 42.4 + Math.sin(i / 300) * 0.05] as [number, number]);
    const created = await createDrawn(a.coordinator, { geometry: { type: 'LineString', coordinates: wander } });
    const [row] = await fixtures.query<{ points: number; distance_m: string }>(`SELECT ST_NPoints(geom) AS points, distance_m::text FROM route_versions WHERE id = $1`, [created.versionId]);
    expect(row!.points).toBeGreaterThan(10_000);
    expect(Number(row!.distance_m)).toBeGreaterThan(150_000);
  });

  it('import: version 1 as a Draft with provenance `imported` and the uploaded file as `source_file_id`', async () => {
    const fileId = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    const response = await call(a.coordinator, 'POST', '/routes', { source: 'import', name: uniq('Imported'), fileId });
    expect(response.status).toBe(201);
    const created = CreatedRoute.parse(await response.json());
    expect(await versionsOf(created.routeId)).toMatchObject([{ version_number: 1, status: 'draft', provenance: 'imported', manually_modified: false, source_file_id: fileId }]);
  });

  it('INV-16: one `route_created` row in the audit log with the actor and no personal data; a rejected one leaves none', async () => {
    const name = uniq('Audited');
    const created = await createDrawn(a.coordinator, { name });
    expect(await auditOf(created.routeId)).toEqual([
      { action: 'route_created', actor_user_id: a.coordinator.userId, organization_id: a.orgId, entity_type: 'route', detail: { name, versionNumber: 1, source: 'drawn' } },
    ]);

    const before = [await count('routes'), await count('route_versions'), await count('route_segments'), await count('audit_log')];
    await expectError(
      await call(a.coordinator, 'POST', '/routes', {
        source: 'drawn',
        name: uniq('Far'),
        geometry: {
          type: 'LineString',
          coordinates: [
            [10, 10],
            [10.01, 10.01],
          ],
        },
      }),
      'OUTSIDE_COVERAGE',
    );
    await expectError(
      await call(a.coordinator, 'POST', '/routes', {
        source: 'drawn',
        name: uniq('Still'),
        geometry: {
          type: 'LineString',
          coordinates: [
            [0.65, 42.6],
            [0.65, 42.6],
          ],
        },
      }),
      'VALIDATION_FAILED',
    );
    expect([await count('routes'), await count('route_versions'), await count('route_segments'), await count('audit_log')]).toEqual(before);
  });

  it('refuses a name that is empty and unknown fields, and writes nothing (`addToMission` has its own tests: mission-routes-writes)', async () => {
    const before = await count('routes');
    await expectError(await call(a.coordinator, 'POST', '/routes', { source: 'drawn', name: '   ', geometry: line() }), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'POST', '/routes', { source: 'drawn', name: uniq('R'), geometry: line(), status: 'validated' }), 'VALIDATION_FAILED');
    expect(await count('routes')).toBe(before);
  });
});

describe('createRouteVersion (RF-505, RN-12; INV-04)', () => {
  it('adds version 2 as an edited Draft, leaves version 1 exactly as it was and moves `latest_version_id`', async () => {
    const created = await createDrawn(a.coordinator);
    const [first] = await versionsOf(created.routeId);
    const response = await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(0.002, 7), note: 'moved east' });
    expect(response.status).toBe(201);
    const second = CreatedRoute.parse(await response.json());
    expect(second).toMatchObject({ routeId: created.routeId, versionNumber: 2 });

    const versions = await versionsOf(created.routeId);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual(first);
    expect(versions[1]).toMatchObject({ version_number: 2, status: 'draft', provenance: 'edited', manually_modified: true, note: 'moved east', source_file_id: null });
    expect(versions[1]!.wkt).not.toBe(first!.wkt);
    expect((await routeRow(created.routeId)).latest_version_id).toBe(second.versionId);
    expect((await auditOf(created.routeId)).map((row) => row.action)).toEqual(['route_created', 'route_version_created']);
  });

  it('two edits at the same time become versions 2 and 3 without an error', async () => {
    const created = await createDrawn(a.coordinator);
    const edit = (member: Member, shift: number) => call(member, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(shift) });
    const [one, two] = await Promise.all([edit(a.coordinator, 0.003), edit(a.secondCoordinator, 0.004)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const numbers = [CreatedRoute.parse(await one.json()).versionNumber, CreatedRoute.parse(await two.json()).versionNumber].sort();
    expect(numbers).toEqual([2, 3]);
    expect((await versionsOf(created.routeId)).map((v) => v.version_number)).toEqual([1, 2, 3]);
  });

  it('a base version of another route is 404, `calculationJobId` is refused until H9 and an archived route is read-only', async () => {
    const [one, other] = [await createDrawn(a.coordinator), await createDrawn(a.coordinator)];
    await expectError(await call(a.coordinator, 'POST', `/routes/${one.routeId}/versions`, { baseVersionId: other.versionId, geometry: line() }), 'NOT_FOUND');
    const refused = await expectError(
      await call(a.coordinator, 'POST', `/routes/${one.routeId}/versions`, { baseVersionId: one.versionId, geometry: line(), calculationJobId: other.versionId }),
      'VALIDATION_FAILED',
    );
    expect(refused.details).toMatchObject({ issues: [{ path: 'calculationJobId' }] });
    expect((await call(a.coordinator, 'POST', `/routes/${one.routeId}/archive`)).status).toBe(200);
    await expectError(await call(a.coordinator, 'POST', `/routes/${one.routeId}/versions`, { baseVersionId: one.versionId, geometry: line() }), 'INVALID_STATE_TRANSITION');
    expect(await versionsOf(one.routeId)).toHaveLength(1);
  });
});

describe('validateRouteVersion (RF-506, RN-12; INV-04)', () => {
  it('turns a Draft into Validated with who and when, sets `latest_validated_version_id` and audits it', async () => {
    const created = await createDrawn(a.coordinator);
    const response = await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true });
    expect(response.status).toBe(200);
    const version = RouteVersion.parse(await response.json());
    expect(version).toMatchObject({ id: created.versionId, number: 1, status: 'validated', validatedBy: { id: a.coordinator.userId } });
    expect(version.validatedAt).toBeTruthy();
    expect(await routeRow(created.routeId)).toMatchObject({ latest_validated_version_id: created.versionId, latest_version_id: created.versionId });
    const audit = await auditOf(created.routeId);
    expect(audit.at(-1)).toMatchObject({ action: 'route_version_validated', actor_user_id: a.coordinator.userId, detail: { versionNumber: 1 } });
  });

  it('needs the explicit acknowledgement: without `acknowledged: true` nothing changes', async () => {
    const created = await createDrawn(a.coordinator);
    const url = `/routes/${created.routeId}/versions/${created.versionId}/validate`;
    await expectError(await call(a.coordinator, 'POST', url, {}), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'POST', url, { acknowledged: false }), 'VALIDATION_FAILED');
    expect((await versionsOf(created.routeId))[0]).toMatchObject({ status: 'draft', validated_by: null });
  });

  it('validating a validated version is 409 VERSION_IMMUTABLE', async () => {
    const created = await createDrawn(a.coordinator);
    const url = `/routes/${created.routeId}/versions/${created.versionId}/validate`;
    expect((await call(a.coordinator, 'POST', url, { acknowledged: true })).status).toBe(200);
    await expectError(await call(a.coordinator, 'POST', url, { acknowledged: true }), 'VERSION_IMMUTABLE');
  });

  it('INV-04: a validated version cannot be modified or deleted, not even by the owner role of the database; its segments do not change', async () => {
    const created = await createDrawn(a.coordinator);
    expect((await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true })).status).toBe(200);
    const [before] = await versionsOf(created.routeId);
    for (const statement of [
      `UPDATE route_versions SET distance_m = distance_m + 1 WHERE id = $1`,
      `UPDATE route_versions SET note = 'changed' WHERE id = $1`,
      `UPDATE route_versions SET status = 'draft', validated_at = NULL, validated_by = NULL WHERE id = $1`,
      `DELETE FROM route_versions WHERE id = $1`,
    ]) {
      await expect(fixtures.query(statement, [created.versionId])).rejects.toThrow(/INV-04/);
    }
    await expect(fixtures.query(`UPDATE route_segments SET distance_m = 1 WHERE version_id = $1`, [created.versionId])).rejects.toThrow(/INV-04/);
    expect((await versionsOf(created.routeId))[0]).toEqual(before);
  });

  it('INV-04: a Draft can only become Validated; editing a validated route adds version 2 and version 1 stays identical in geometry and metrics', async () => {
    const created = await createDrawn(a.coordinator);
    await expect(fixtures.query(`UPDATE route_versions SET distance_m = distance_m + 1 WHERE id = $1`, [created.versionId])).rejects.toThrow(/INV-04/);
    expect((await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true })).status).toBe(200);
    const [validated] = await versionsOf(created.routeId);
    const second = await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(0.001, 8) });
    expect(second.status).toBe(201);
    const versions = await versionsOf(created.routeId);
    expect(versions[0]).toEqual(validated);
    expect(versions[1]).toMatchObject({ version_number: 2, status: 'draft' });
    expect(versions[1]!.distance_m).not.toBe(validated!.distance_m);
  });

  it('the latest validated version is the highest number validated: validating an older Draft later does not move it back', async () => {
    const created = await createDrawn(a.coordinator);
    const second = CreatedRoute.parse(await (await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(0.002) })).json());
    const validate = (versionId: string) => call(a.coordinator, 'POST', `/routes/${created.routeId}/versions/${versionId}/validate`, { acknowledged: true });
    expect((await validate(second.versionId)).status).toBe(200);
    expect((await validate(created.versionId)).status).toBe(200);
    expect((await routeRow(created.routeId)).latest_validated_version_id).toBe(second.versionId);
  });

  it('an archived route cannot be validated', async () => {
    const created = await createDrawn(a.coordinator);
    expect((await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`)).status).toBe(200);
    await expectError(await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true }), 'INVALID_STATE_TRANSITION');
  });
});

describe('deriveRoute (RF-517)', () => {
  it('without geometry copies the version exactly into a new route that remembers where it comes from, and never touches the original', async () => {
    const original = await createDrawn(a.coordinator, { name: uniq('Original') });
    expect((await call(a.coordinator, 'POST', `/routes/${original.routeId}/versions/${original.versionId}/validate`, { acknowledged: true })).status).toBe(200);
    const [before] = await versionsOf(original.routeId);
    const originalRow = await routeRow(original.routeId);

    const name = uniq('Copy');
    const response = await call(a.coordinator, 'POST', `/routes/${original.routeId}/derive`, { name, fromVersionId: original.versionId, note: 'for the other valley' });
    expect(response.status).toBe(201);
    const copy = CreatedRoute.parse(await response.json());
    expect(copy.routeId).not.toBe(original.routeId);
    expect(copy).toMatchObject({ versionNumber: 1, missionRouteId: null });

    expect(await routeRow(copy.routeId)).toMatchObject({
      name,
      derived_from_route_id: original.routeId,
      derived_from_version_id: original.versionId,
      latest_version_id: copy.versionId,
      latest_validated_version_id: null,
    });
    const [copied] = await versionsOf(copy.routeId);
    expect(copied).toMatchObject({ version_number: 1, status: 'draft', validated_by: null, note: 'for the other valley', created_by: a.coordinator.userId });
    expect(copied!.wkt).toBe(before!.wkt);
    expect(copied!.distance_m).toBe(before!.distance_m);
    const segments = await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM route_segments WHERE version_id = $1`, [copy.versionId]);
    expect(segments[0]!.n).toBe('1');

    expect((await versionsOf(original.routeId))[0]).toEqual(before);
    expect(await routeRow(original.routeId)).toEqual(originalRow);
    expect((await auditOf(copy.routeId)).map((row) => row.action)).toEqual(['route_derived']);
    expect((await auditOf(copy.routeId))[0]!.detail).toMatchObject({ name, fromRouteId: original.routeId, fromVersionNumber: 1, geometryChanged: false });
  });

  it('with geometry measures it as an edited version', async () => {
    const original = await createDrawn(a.coordinator);
    const copy = CreatedRoute.parse(
      await (await call(a.coordinator, 'POST', `/routes/${original.routeId}/derive`, { name: uniq('Changed'), fromVersionId: original.versionId, geometry: line(0.005, 9) })).json(),
    );
    const [version] = await versionsOf(copy.routeId);
    expect(version).toMatchObject({ provenance: 'edited', manually_modified: true });
    expect(version!.wkt).not.toBe((await versionsOf(original.routeId))[0]!.wkt);
  });

  it('works on an archived route (it is how one is recovered), and refuses a version of another route, a mission that is not there and `calculationJobId`', async () => {
    const [one, other] = [await createDrawn(a.coordinator), await createDrawn(a.coordinator)];
    expect((await call(a.coordinator, 'POST', `/routes/${one.routeId}/archive`)).status).toBe(200);
    const copy = await call(a.coordinator, 'POST', `/routes/${one.routeId}/derive`, { name: uniq('Recovered'), fromVersionId: one.versionId });
    expect(copy.status).toBe(201);
    expect((await routeRow(CreatedRoute.parse(await copy.json()).routeId)).status).toBe('active');
    await expectError(await call(a.coordinator, 'POST', `/routes/${other.routeId}/derive`, { name: uniq('X'), fromVersionId: one.versionId }), 'NOT_FOUND');
    await expectError(
      await call(a.coordinator, 'POST', `/routes/${other.routeId}/derive`, { name: uniq('X'), fromVersionId: other.versionId, calculationJobId: other.versionId }),
      'VALIDATION_FAILED',
    );
    await expectError(
      await call(a.coordinator, 'POST', `/routes/${other.routeId}/derive`, { name: uniq('X'), fromVersionId: other.versionId, addToMission: { missionId: other.versionId } }),
      'NOT_FOUND', // a mission that is not there (H4: `addToMission` is implemented)
    );
  });
});

describe('archiveRoute (RN-14; INV-07)', () => {
  it('archives a route and answers its detail; there is no DELETE', async () => {
    const created = await createDrawn(a.coordinator);
    const response = await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`);
    expect(response.status).toBe(200);
    const body = RouteDetail.parse(await response.json());
    expect(body).toMatchObject({ id: created.routeId, status: 'archived', versions: [{ number: 1, status: 'draft' }], derivedFrom: null, derivatives: [], usedIn: [] });
    expect((await auditOf(created.routeId)).at(-1)).toMatchObject({ action: 'route_archived', detail: { name: body.name } });
    expect((await call(a.coordinator, 'DELETE', `/routes/${created.routeId}`)).status).toBe(404);
    expect((await routeRow(created.routeId)).status).toBe('archived');
  });

  it('archiving an archived route is 409 INVALID_STATE_TRANSITION', async () => {
    const created = await createDrawn(a.coordinator);
    expect((await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`)).status).toBe(200);
    await expectError(await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`), 'INVALID_STATE_TRANSITION');
  });

  it('INV-07: a route in a mission that is not closed is 409 ROUTE_IN_USE with that mission; once the mission is closed it archives', async () => {
    const created = await createDrawn(a.coordinator);
    expect((await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true })).status).toBe(200);
    const missionName = uniq('In use');
    const { id: missionId } = MissionDetail.parse(await (await call(a.coordinator, 'POST', '/missions', { name: missionName, target: { source: 'map', lat: 42.6, lon: 0.65 } })).json());
    // The operation that adds a route to a mission arrives with H4: the row is inserted as the owner role, the way that operation will.
    await fixtures.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) VALUES ($1, $2, $3, $4, $5)`, [
      a.orgId,
      missionId,
      created.routeId,
      created.versionId,
      a.coordinator.userId,
    ]);

    const error = await expectError(await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`), 'ROUTE_IN_USE');
    expect(error.details).toEqual({ missions: [{ id: missionId, name: missionName }] });
    expect((await routeRow(created.routeId)).status).toBe('active');
    // The trigger is the second defence: the same statement as the owner role is refused by the database.
    await expect(fixtures.query(`UPDATE routes SET status = 'archived' WHERE id = $1`, [created.routeId])).rejects.toThrow(/INV-07/);

    await fixtures.query(`UPDATE missions SET status = 'active', activated_at = now() WHERE id = $1`, [missionId]);
    await expectError(await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`), 'ROUTE_IN_USE');
    await fixtures.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [missionId]);
    const archived = await call(a.coordinator, 'POST', `/routes/${created.routeId}/archive`);
    expect(archived.status).toBe(200);
    expect(RouteDetail.parse(await archived.json()).usedIn).toEqual([{ missionId, missionName, missionStatus: 'closed', pinnedVersionNumber: 1 }]);
  });
});

describe('isolation and roles (INV-01, rule 2)', () => {
  it('INV-01: the coordinator of B gets 404 on the five operations over A’s routes, versions and files, and nothing changes in A', async () => {
    const created = await createDrawn(a.coordinator);
    const fileOfA = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    const [versionsBefore, routeBefore, auditBefore, routesBefore] = [await versionsOf(created.routeId), await routeRow(created.routeId), await auditOf(created.routeId), await count('routes')];

    await expectError(await call(b.coordinator, 'POST', '/routes', { source: 'import', name: uniq('Steal'), fileId: fileOfA }), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line() }), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'POST', `/routes/${created.routeId}/derive`, { name: uniq('Steal'), fromVersionId: created.versionId }), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true }), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'POST', `/routes/${created.routeId}/archive`), 'NOT_FOUND');

    expect(await versionsOf(created.routeId)).toEqual(versionsBefore);
    expect(await routeRow(created.routeId)).toEqual(routeBefore);
    expect(await auditOf(created.routeId)).toEqual(auditBefore);
    expect(await count('routes')).toBe(routesBefore);
  });

  it('the administrator and the rescuer get 403 on every write; nothing is created', async () => {
    const created = await createDrawn(a.coordinator);
    const before = await count('routes');
    for (const member of [a.admin, a.rescuer]) {
      await expectError(await call(member, 'POST', '/routes', { source: 'drawn', name: uniq('No'), geometry: line() }), 'FORBIDDEN');
      await expectError(await call(member, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line() }), 'FORBIDDEN');
      await expectError(await call(member, 'POST', `/routes/${created.routeId}/derive`, { name: uniq('No'), fromVersionId: created.versionId }), 'FORBIDDEN');
      await expectError(await call(member, 'POST', `/routes/${created.routeId}/versions/${created.versionId}/validate`, { acknowledged: true }), 'FORBIDDEN');
      await expectError(await call(member, 'POST', `/routes/${created.routeId}/archive`), 'FORBIDDEN');
    }
    expect(await count('routes')).toBe(before);
    expect(await versionsOf(created.routeId)).toHaveLength(1);
  });
});
