import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ERROR_HTTP, ErrorResponse, FileRef, ImportPreview, MissionDetail, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// previewRouteImport and importMissionPoints (H2-T4): the server measures what a file brings and ignores its altitudes (INV-15, RN-10).
let app: TestApp;
let fixtures: Fixtures;
const storage = new InMemoryFileStorage();
const synthetic = new SyntheticElevationProvider();

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
}
let a: Org;
let b: Org;
let applicant: Member;
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
  app = await startApp({ database: appConnection, files: { storage } });
  a = await build('Org A');
  b = await build('Org B');
  applicant = await fixtures.applicant(a.orgId, 'pending', options);
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

const fixtureFile = (name: string) => readFile(new URL(`../../../../packages/geo/test/fixtures/${name}`, import.meta.url), 'utf8');

/** Uploads `content` as `member` and returns the file id. */
async function upload(member: Member, content: string, type = 'application/gpx+xml'): Promise<string> {
  const form = new FormData();
  form.set('purpose', 'route_import');
  form.set('file', new Blob([content], { type }), 'track.gpx');
  const response = await fetch(`${app.baseUrl}/files`, { method: 'POST', headers: withSession(await sessionOf(member)), body: form });
  expect(response.status).toBe(201);
  return FileRef.parse(await response.json()).id;
}

const gpx = (points: string, extra = '') =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">${extra}<trk><name>Ficticia</name><trkseg>${points}</trkseg></trk></gpx>`;
const trkpt = (lat: number, lon: number, ele?: number) => `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;
const walk = (ele?: number) => gpx([0, 1, 2, 3, 4, 5, 6, 7].map((i) => trkpt(42.6 + i * 0.0012, 0.65 + i * 0.0009, ele)).join(''));

const count = async (table: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);
const preview = (member: Member, fileId: string) => call(member, 'POST', '/routes/import/preview', { fileId });

describe('previewRouteImport: the server measures, the file’s altitudes are ignored (INV-15, RN-10)', () => {
  it('returns the candidate with the server’s altitudes and metrics, one `unknown` stretch and the warnings of the file', async () => {
    const fileId = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    const response = await preview(a.coordinator, fileId);
    expect(response.status).toBe(200);
    const body = ImportPreview.parse(await response.json());

    expect(body.trackName).toBe('Sendero ficticio');
    expect(body.waypointCount).toBe(2);
    expect(body.warnings).toEqual(['elevation_recomputed', 'waypoints_ignored']);
    expect(body.candidate.offTrailShare).toBe(0);
    expect(body.candidate.roadMix).toEqual([{ roadType: 'unknown', distanceM: body.candidate.metrics.distanceM }]);
    for (const [lon, lat, height] of body.candidate.geometry.coordinates) expect(height).toBe(await synthetic.elevationAt({ lat, lon }));
    expect(body.candidate.metrics.distanceM).toBeGreaterThan(50);
  });

  it('INV-15: a file with an altitude of 999 m at every point gives the same candidate as the same track without altitude, and 999 never comes back', async () => {
    const withFake = await upload(a.coordinator, walk(999));
    const without = await upload(a.coordinator, walk());
    const faked = await preview(a.coordinator, withFake);
    const plain = await preview(a.coordinator, without);
    const [fakedText, plainText] = [await faked.text(), await plain.text()];
    expect(fakedText).toBe(plainText);
    expect(fakedText).not.toMatch(/[[,:]999[,\]}]/);
    expect(fakedText).not.toContain('"999');
  });

  it('warns when the file has several tracks and uses the first one', async () => {
    const fileId = await upload(a.coordinator, await fixtureFile('dos-pistas.gpx'));
    const body = ImportPreview.parse(await (await preview(a.coordinator, fileId)).json());
    expect(body.warnings).toContain('multiple_tracks_only_first_used');
    expect(body.warnings).not.toContain('waypoints_ignored');
  });

  it('reads a KML the same way', async () => {
    const fileId = await upload(a.coordinator, await fixtureFile('linestring.kml'), 'application/vnd.google-earth.kml+xml');
    const body = ImportPreview.parse(await (await preview(a.coordinator, fileId)).json());
    expect(body.candidate.geometry.coordinates.length).toBeGreaterThan(4);
    expect(body.warnings).toEqual(['elevation_recomputed', 'waypoints_ignored']);
  });

  it('writes nothing: no route, no version, no audit row, no new file', async () => {
    const fileId = await upload(a.coordinator, walk());
    const before = [await count('routes'), await count('route_versions'), await count('audit_log'), await count('files'), storage.size];
    expect((await preview(a.coordinator, fileId)).status).toBe(200);
    expect([await count('routes'), await count('route_versions'), await count('audit_log'), await count('files'), storage.size]).toEqual(before);
  });

  it('OUTSIDE_COVERAGE (422) for a track no elevation source covers, and a track with no length is VALIDATION_FAILED', async () => {
    const far = await upload(a.coordinator, gpx([trkpt(10, 10), trkpt(10.01, 10.01)].join('')));
    await expectError(await preview(a.coordinator, far), 'OUTSIDE_COVERAGE');
    const still = await upload(a.coordinator, gpx([trkpt(42.6, 0.65), trkpt(42.6, 0.65)].join('')));
    await expectError(await preview(a.coordinator, still), 'VALIDATION_FAILED');
  });

  it('INV-01: a file of another organization, and one that does not exist, are 404', async () => {
    const ofA = await upload(a.coordinator, walk());
    await expectError(await preview(b.coordinator, ofA), 'NOT_FOUND');
    await expectError(await preview(a.coordinator, '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
  });

  it('answers 404 when the bytes of the file are gone from the store', async () => {
    const fileId = await upload(a.coordinator, walk());
    const [row] = await fixtures.query<{ storage_key: string }>(`SELECT storage_key FROM files WHERE id = $1`, [fileId]);
    await storage.delete(row!.storage_key);
    await expectError(await preview(a.coordinator, fileId), 'NOT_FOUND');
  });

  it('the administrator may preview a file of the organization; the rescuer gets 403 and a pending account has no access (INV-25)', async () => {
    const fileId = await upload(a.coordinator, walk());
    expect((await preview(a.admin, fileId)).status).toBe(200);
    await expectError(await preview(a.rescuer, fileId), 'FORBIDDEN');
    await expectError(await preview(applicant, fileId), 'ACCOUNT_PENDING');
  });

  it('VALIDATION_FAILED for a body that is not { fileId }', async () => {
    await expectError(await call(a.coordinator, 'POST', '/routes/import/preview', { fileId: 'nope' }), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'POST', '/routes/import/preview', { fileId: '00000000-0000-4000-8000-000000000000', geometry: {} }), 'VALIDATION_FAILED');
  });
});

describe('importMissionPoints: the named points of a file become points of the mission (RF-405, INV-16, INV-11)', () => {
  const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
  async function missionOf(member: Member): Promise<string> {
    const response = await call(member, 'POST', '/missions', { name: uniq('Mission'), target: { source: 'map', lat: 42.6, lon: 0.65 } });
    expect(response.status).toBe(201);
    return MissionDetail.parse(await response.json()).id;
  }
  const importPoints = (member: Member, missionId: string, fileId: string, kind = 'waypoint') => call(member, 'POST', `/missions/${missionId}/points/import`, { fileId, kind });
  const pointsOf = (missionId: string) =>
    fixtures.query<{ name: string; kind: string; position: number; z: number }>(
      `SELECT name, kind::text AS kind, position, ST_Z(geom) AS z FROM mission_points WHERE mission_id = $1 ORDER BY kind, position`,
      [missionId],
    );
  const auditOf = (missionId: string) =>
    fixtures.query<{ action: string; actor_user_id: string; detail: { name: string; source?: string } }>(`SELECT action, actor_user_id, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`, [
      missionId,
    ]);

  it('creates one point per named point with the server’s altitude and one `point_added` row each', async () => {
    const missionId = await missionOf(a.coordinator);
    const existing = await call(a.coordinator, 'POST', `/missions/${missionId}/points`, { kind: 'waypoint', name: 'Existing', lat: 42.61, lon: 0.66 });
    expect(existing.status).toBe(201);
    const fileId = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    const auditBefore = (await auditOf(missionId)).length;

    const response = await importPoints(a.coordinator, missionId, fileId);
    expect(response.status).toBe(201);
    const { items } = (await response.json()) as { items: { name: string; kind: string; lat: number; lon: number; elevationM: number; position: number }[] };
    expect(items.map((p) => [p.name, p.kind, p.position])).toEqual([
      ['Refugio & ficticio', 'waypoint', 1],
      ['Collado inventado', 'waypoint', 2],
    ]);
    for (const item of items) expect(item.elevationM).toBe(await synthetic.elevationAt({ lat: item.lat, lon: item.lon }));

    const rows = await pointsOf(missionId);
    expect(rows.map((r) => r.name)).toEqual(['Existing', 'Refugio & ficticio', 'Collado inventado']);
    expect(rows.some((r) => r.z === 999)).toBe(false);
    const audit = (await auditOf(missionId)).slice(auditBefore);
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.action === 'point_added' && row.actor_user_id === a.coordinator.userId && row.detail.source === 'import')).toBe(true);
  });

  it('reads the Point placemarks of a KML and imports them with the kind asked for', async () => {
    const missionId = await missionOf(a.coordinator);
    const fileId = await upload(a.coordinator, await fixtureFile('linestring.kml'), 'application/vnd.google-earth.kml+xml');
    const response = await importPoints(a.coordinator, missionId, fileId, 'origin');
    expect(response.status).toBe(201);
    expect(await pointsOf(missionId)).toMatchObject([{ name: 'Refugio ficticio', kind: 'origin', position: 0 }]);
  });

  it('INV-11: a closed mission answers 409 MISSION_CLOSED and nothing is added', async () => {
    const missionId = await missionOf(a.coordinator);
    await fixtures.query(`UPDATE missions SET status = 'active', activated_at = now() WHERE id = $1`, [missionId]);
    await fixtures.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [missionId]);
    const fileId = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    const auditBefore = (await auditOf(missionId)).length;
    await expectError(await importPoints(a.coordinator, missionId, fileId), 'MISSION_CLOSED');
    expect(await pointsOf(missionId)).toEqual([]);
    expect((await auditOf(missionId)).length).toBe(auditBefore);
  });

  it('INV-01: B cannot use A’s file, nor import into A’s mission; both are 404', async () => {
    const missionOfA = await missionOf(a.coordinator);
    const missionOfB = await missionOf(b.coordinator);
    const fileOfA = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    await expectError(await importPoints(b.coordinator, missionOfB, fileOfA), 'NOT_FOUND');
    await expectError(await importPoints(b.coordinator, missionOfA, fileOfA), 'NOT_FOUND');
    expect(await pointsOf(missionOfA)).toEqual([]);
    expect(await pointsOf(missionOfB)).toEqual([]);
  });

  it('INVALID_FILE_CONTENT when the file has no named points or has more than 100, and OUTSIDE_COVERAGE when one is out of range; nothing is added', async () => {
    const missionId = await missionOf(a.coordinator);
    const none = await upload(a.coordinator, await fixtureFile('solo-ruta.gpx'));
    await expectError(await importPoints(a.coordinator, missionId, none), 'INVALID_FILE_CONTENT');
    const wpt = (i: number, lat = 42.6) => `<wpt lat="${lat + i * 0.0001}" lon="0.65"><name>P ${i}</name></wpt>`;
    const many = await upload(a.coordinator, gpx([trkpt(42.6, 0.65), trkpt(42.61, 0.66)].join(''), Array.from({ length: 101 }, (_, i) => wpt(i)).join('')));
    await expectError(await importPoints(a.coordinator, missionId, many), 'INVALID_FILE_CONTENT');
    const outside = await upload(a.coordinator, gpx([trkpt(42.6, 0.65), trkpt(42.61, 0.66)].join(''), `${wpt(1)}${wpt(2, 10)}`));
    await expectError(await importPoints(a.coordinator, missionId, outside), 'OUTSIDE_COVERAGE');
    expect(await pointsOf(missionId)).toEqual([]);
  });

  it('the administrator and the rescuer get 403; a pending account has no access', async () => {
    const missionId = await missionOf(a.coordinator);
    const fileId = await upload(a.coordinator, await fixtureFile('ficticio-sendero.gpx'));
    await expectError(await importPoints(a.admin, missionId, fileId), 'FORBIDDEN');
    await expectError(await importPoints(a.rescuer, missionId, fileId), 'FORBIDDEN');
    await expectError(await importPoints(applicant, missionId, fileId), 'ACCOUNT_PENDING');
    expect(await pointsOf(missionId)).toEqual([]);
  });
});
