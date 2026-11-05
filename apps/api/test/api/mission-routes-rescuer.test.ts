import { randomBytes } from 'node:crypto';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, MissionDetail, MissionPoint, MissionRouteGeometry, MissionRoutesRescuer, MissionRoutesStaff, RouteDetail, type ErrorCode } from '@onway/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { FixedClock } from '../support/clock.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// listMyMissionRoutes, getMyMissionRouteGeometry, exportMyMissionRoutes and exportMissionRoutes (H4-T3) on real PostGIS:
// INV-05 and RN-03 (the rescuer only gets the PINNED version and only if it is validated), RN-16 (a mission in planning is not there),
// INV-01 (another organization is a 404) and P2 (what each role exports). The policies of the database are checked in test/db.
let app: TestApp;
let fixtures: Fixtures;
const clock = new FixedClock(new Date());

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
  // The clock moves by months (the stale validation): the sessions must outlive it.
  app = await startApp({ database: appConnection, clock, identity: { sessionTtlMs: 3000 * 86_400_000 } });
  a = await build('Org A');
  b = await build('Org B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function call(member: Member, method: string, path: string, body?: unknown): Promise<Response> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  const session = sessions.get(member.userId)!;
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
}

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
const line = (lon: number, lat: number, count = 6, step = 0.0012) => ({
  type: 'LineString' as const,
  coordinates: Array.from({ length: count }, (_, i) => [lon + i * step, lat + i * step * 0.75] as [number, number]),
});
const SECRET_NOTE = 'NOTA-INTERNA-SOLO-PARA-EL-PERSONAL';

async function newMission(member: Member, activate = false): Promise<{ id: string; originId: string }> {
  const response = await call(member, 'POST', '/missions', { name: uniq('Mission'), target: { source: 'map', lat: 42.61, lon: 0.67 } });
  expect(response.status).toBe(201);
  const id = MissionDetail.parse(await response.json()).id;
  const point = await call(member, 'POST', `/missions/${id}/points`, { kind: 'origin', name: 'Origen de prueba', lat: 42.6, lon: 0.65 });
  expect(point.status).toBe(201);
  if (activate) await activateMission(member, id);
  return { id, originId: MissionPoint.parse(await point.json()).id };
}
const activateMission = async (member: Member, missionId: string) => expect((await call(member, 'POST', `/missions/${missionId}/activate`, { confirmWithoutValidatedRoute: true })).status).toBe(200);
const closeMission = async (member: Member, missionId: string) => expect((await call(member, 'POST', `/missions/${missionId}/close`, { attendance: [] })).status).toBe(200);

async function newRoute(member: Member, name = uniq('Route'), geometry = line(0.65, 42.6)) {
  const response = await call(member, 'POST', '/routes', { source: 'drawn', name, geometry });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
const validate = async (member: Member, routeId: string, versionId: string) =>
  expect((await call(member, 'POST', `/routes/${routeId}/versions/${versionId}/validate`, { acknowledged: true })).status).toBe(200);
async function newVersion(member: Member, routeId: string, baseVersionId: string, geometry = line(0.66, 42.61)) {
  const response = await call(member, 'POST', `/routes/${routeId}/versions`, { baseVersionId, geometry });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
async function addRoute(member: Member, missionId: string, item: Record<string, unknown>) {
  const response = await call(member, 'POST', `/missions/${missionId}/routes`, { items: [item] });
  expect(response.status).toBe(201);
  return MissionRoutesStaff.parse(await response.json()).items[0]!;
}
/** A route with a validated version 1, pinned in the mission. */
async function validatedInMission(member: Member, missionId: string, extra: Record<string, unknown> = {}, name = uniq('Route'), geometry = line(0.65, 42.6)) {
  const route = await newRoute(member, name, geometry);
  await validate(member, route.routeId, route.versionId);
  const row = await addRoute(member, missionId, { routeId: route.routeId, ...extra });
  return { ...route, missionRouteId: row.id, name };
}
const patch = (member: Member, missionId: string, missionRouteId: string, body: unknown) => call(member, 'PATCH', `/missions/${missionId}/routes/${missionRouteId}`, body);
async function mine(member: Member, missionId: string) {
  const response = await call(member, 'GET', `/my/missions/${missionId}/routes`);
  expect(response.status).toBe(200);
  return MissionRoutesRescuer.parse(await response.json()).items;
}
const trackPoints = (gpx: string) => [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"><ele>([-\d.]+)<\/ele>/g)].map((m) => [Number(m[2]), Number(m[1]), Number(m[3])]);
const trackNames = (gpx: string) => [...gpx.matchAll(/<trk><name>([^<]*)<\/name>/g)].map((m) => m[1]);

describe('listMyMissionRoutes (RF-601, RF-602, INV-05, RN-03)', () => {
  it('RN-16: a mission in planning is not there for the rescuer; once active, the validated route is', async () => {
    const mission = await newMission(a.coordinator);
    await validatedInMission(a.coordinator, mission.id);
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes`), 'NOT_FOUND');
    await activateMission(a.coordinator, mission.id);
    expect(await mine(a.rescuer, mission.id)).toHaveLength(1);
  });

  it('INV-05: a route whose PINNED version is a Draft is not listed, even if the route has a validated version', async () => {
    const mission = await newMission(a.coordinator, true);
    const visible = await validatedInMission(a.coordinator, mission.id);
    const draft = await newRoute(a.coordinator);
    const v2 = await newVersion(a.coordinator, draft.routeId, draft.versionId);
    await validate(a.coordinator, draft.routeId, v2.versionId); // validated, but version 1 (a Draft) is the pinned one
    await addRoute(a.coordinator, mission.id, { routeId: draft.routeId, versionId: draft.versionId });

    expect((await mine(a.rescuer, mission.id)).map((r) => r.routeId)).toEqual([visible.routeId]);
    // The coordinator sees both: the Draft one is only hidden from the rescuer.
    const staff = MissionRoutesStaff.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes`)).json());
    expect(staff.items).toHaveLength(2);
  });

  it('RN-03 and RN-13: the rescuer gets the PINNED version, not a newer validated one, until the coordinator moves it', async () => {
    const mission = await newMission(a.coordinator, true);
    const route = await validatedInMission(a.coordinator, mission.id);
    const v2 = await newVersion(a.coordinator, route.routeId, route.versionId, line(0.7, 42.62, 9));
    await validate(a.coordinator, route.routeId, v2.versionId);

    const before = (await mine(a.rescuer, mission.id))[0]!;
    expect(before.versionNumber).toBe(1);
    const staffDistance = MissionRoutesStaff.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes`)).json()).items[0]!.pinned.metrics.distanceM;
    expect(before.metrics.distanceM).toBe(staffDistance);

    expect((await patch(a.coordinator, mission.id, route.missionRouteId, { pinnedVersionId: v2.versionId })).status).toBe(200);
    const after = (await mine(a.rescuer, mission.id))[0]!;
    expect(after.versionNumber).toBe(2);
    expect(after.metrics.distanceM).not.toBe(before.metrics.distanceM);
  });

  it('the answer carries nothing internal: no note, no Draft, no who validated, no version ids (the whole JSON)', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id, { note: SECRET_NOTE });
    const response = await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes`);
    const text = await response.text();
    expect(text).not.toContain(SECRET_NOTE);
    expect(text).not.toMatch(/"note"|validatedBy|validated_by|"draft"|pinned|versionId|newerValidatedVersion|addedAt|createdBy/);
    expect(text).not.toContain(a.coordinator.userId);
    const [row] = MissionRoutesRescuer.parse(JSON.parse(text)).items;
    expect(Object.keys(row!).sort()).toEqual(
      ['id', 'metrics', 'name', 'origin', 'previewGeometry', 'roadMix', 'routeId', 'status', 'team', 'validatedAt', 'validationIsStale', 'versionNumber'].sort(),
    );
  });

  it('RF-508: an unavailable route is listed and marked, not hidden; reactivating it clears the mark', async () => {
    const mission = await newMission(a.coordinator, true);
    const route = await validatedInMission(a.coordinator, mission.id);
    await validatedInMission(a.coordinator, mission.id, {}, uniq('Other'), line(0.7, 42.62));
    expect((await patch(a.coordinator, mission.id, route.missionRouteId, { status: 'unavailable' })).status).toBe(200);
    const rows = await mine(a.rescuer, mission.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.routeId === route.routeId)!.status).toBe('unavailable');
    expect(rows.filter((r) => r.status === 'unavailable')).toHaveLength(1);
    expect((await patch(a.coordinator, mission.id, route.missionRouteId, { status: 'added' })).status).toBe(200);
    expect((await mine(a.rescuer, mission.id)).every((r) => r.status === 'added')).toBe(true);
  });

  it('RF-519: the mark of an old validation is computed by the server with the Clock and the limit of the organization', async () => {
    const mission = await newMission(a.coordinator, true);
    const route = await validatedInMission(a.coordinator, mission.id);
    const validatedAt = new Date(RouteDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${route.routeId}`)).json()).versions[0]!.validatedAt!).getTime();
    try {
      clock.set(new Date(validatedAt + 89 * 86_400_000));
      expect((await mine(a.rescuer, mission.id))[0]!.validationIsStale).toBe(false);
      clock.set(new Date(validatedAt + 91 * 86_400_000));
      expect((await mine(a.rescuer, mission.id))[0]!.validationIsStale).toBe(true);
    } finally {
      clock.set(new Date());
    }
  });

  it('shows the origin; the team only to a member of it (the policy teams_select); rows come in the order they were added', async () => {
    const mission = await newMission(a.coordinator, true);
    const team = await fixtures.team(a.orgId, 'Seguimiento');
    const first = await validatedInMission(a.coordinator, mission.id, { originPointId: mission.originId, teamId: team });
    const second = await validatedInMission(a.coordinator, mission.id, {}, uniq('Second'), line(0.7, 42.62));
    let rows = await mine(a.rescuer, mission.id);
    expect(rows.map((r) => r.routeId)).toEqual([first.routeId, second.routeId]);
    expect(rows[0]).toMatchObject({ origin: { id: mission.originId, name: 'Origen de prueba' }, team: null });
    expect(rows[1]).toMatchObject({ origin: null, team: null });
    await fixtures.addToTeam(team, a.rescuer);
    rows = await mine(a.rescuer, mission.id);
    expect(rows[0]!.team).toMatchObject({ id: team, locality: 'Locality' });
  });

  it('the API and the policies of the database agree: the ids the API lists are the ones `onway_app` reads as a rescuer', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id);
    const off = await validatedInMission(a.coordinator, mission.id, {}, uniq('Off'), line(0.7, 42.62));
    await patch(a.coordinator, mission.id, off.missionRouteId, { status: 'unavailable' });
    const draft = await newRoute(a.coordinator);
    await addRoute(a.coordinator, mission.id, { routeId: draft.routeId });

    const pool = new pg.Pool({ ...inject('database').app, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', 'rescuer', true)`, [a.orgId, a.rescuer.userId]);
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM mission_routes WHERE mission_id = $1`, [mission.id]);
      expect(rows.map((r) => r.id).sort()).toEqual((await mine(a.rescuer, mission.id)).map((r) => r.id).sort());
      expect(rows).toHaveLength(2);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });

  it('a closed mission is read; an empty one answers an empty list', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id);
    const empty = await newMission(a.coordinator, true);
    await closeMission(a.coordinator, mission.id);
    expect(await mine(a.rescuer, mission.id)).toHaveLength(1);
    expect(await mine(a.rescuer, empty.id)).toEqual([]);
  });

  it('INV-01: the mission of another organization is a 404, and the staff of this one are refused (these are the rescuer operations)', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id);
    await expectError(await call(b.rescuer, 'GET', `/my/missions/${mission.id}/routes`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', `/my/missions/${mission.id}/routes`), 'FORBIDDEN');
    await expectError(await call(a.admin, 'GET', `/my/missions/${mission.id}/routes`), 'FORBIDDEN');
    await expectError(await call(a.rescuer, 'GET', '/my/missions/00000000-0000-4000-8000-000000000000/routes'), 'NOT_FOUND');
  });
});

describe('getMyMissionRouteGeometry (RF-602, INV-05)', () => {
  it('answers with the line, stretches and profile of the PINNED version, the same as the staff get', async () => {
    const mission = await newMission(a.coordinator, true);
    const route = await validatedInMission(a.coordinator, mission.id);
    const v2 = await newVersion(a.coordinator, route.routeId, route.versionId, line(0.9, 42.4, 9));
    await validate(a.coordinator, route.routeId, v2.versionId);

    const response = await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/${route.missionRouteId}/geometry`);
    expect(response.status).toBe(200);
    const geometry = MissionRouteGeometry.parse(await response.json());
    expect(geometry).toMatchObject({ missionRouteId: route.missionRouteId, versionNumber: 1 });
    expect(geometry.segments.length).toBeGreaterThan(0);
    expect(geometry.elevationProfile.length).toBeGreaterThan(1);
    const staff = MissionRouteGeometry.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/${route.missionRouteId}/geometry`)).json());
    expect(geometry).toEqual(staff);
  });

  it('INV-05: the geometry of a route whose pinned version is a Draft is a 404 for the rescuer, and the coordinator still reads it', async () => {
    const mission = await newMission(a.coordinator, true);
    const draft = await newRoute(a.coordinator);
    const row = await addRoute(a.coordinator, mission.id, { routeId: draft.routeId });
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/${row.id}/geometry`), 'NOT_FOUND');
    expect((await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/${row.id}/geometry`)).status).toBe(200);
    // Validating the pinned version is what makes it visible (no other change is needed).
    await validate(a.coordinator, draft.routeId, draft.versionId);
    expect((await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/${row.id}/geometry`)).status).toBe(200);
  });

  it('an unavailable route still draws (it is marked, not hidden)', async () => {
    const mission = await newMission(a.coordinator, true);
    const route = await validatedInMission(a.coordinator, mission.id);
    await patch(a.coordinator, mission.id, route.missionRouteId, { status: 'unavailable' });
    expect((await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/${route.missionRouteId}/geometry`)).status).toBe(200);
  });

  it('RN-16, INV-01: planning, another mission, another organization and an unknown id are all 404', async () => {
    const planning = await newMission(a.coordinator);
    const inPlanning = await validatedInMission(a.coordinator, planning.id);
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${planning.id}/routes/${inPlanning.missionRouteId}/geometry`), 'NOT_FOUND');

    const mission = await newMission(a.coordinator, true);
    const other = await newMission(a.coordinator, true);
    const route = await validatedInMission(a.coordinator, mission.id);
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${other.id}/routes/${route.missionRouteId}/geometry`), 'NOT_FOUND');
    await expectError(await call(b.rescuer, 'GET', `/my/missions/${mission.id}/routes/${route.missionRouteId}/geometry`), 'NOT_FOUND');
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/00000000-0000-4000-8000-000000000000/geometry`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', `/my/missions/${mission.id}/routes/${route.missionRouteId}/geometry`), 'FORBIDDEN');
  });
});

describe('exportMyMissionRoutes (RF-603, P2, INV-05)', () => {
  it('exports only the validated, pinned and available routes, with the pinned geometry, no author and a plain file name', async () => {
    const mission = await newMission(a.coordinator, true);
    const good = await validatedInMission(a.coordinator, mission.id, {}, 'Ruta ñandú buena');
    const v2 = await newVersion(a.coordinator, good.routeId, good.versionId, line(0.9, 42.4, 9));
    await validate(a.coordinator, good.routeId, v2.versionId); // newer, not pinned: must not be exported
    const unavailable = await validatedInMission(a.coordinator, mission.id, {}, 'Ruta no disponible', line(0.7, 42.62));
    await patch(a.coordinator, mission.id, unavailable.missionRouteId, { status: 'unavailable' });
    const draft = await newRoute(a.coordinator, 'Ruta borrador', line(0.8, 42.63));
    await addRoute(a.coordinator, mission.id, { routeId: draft.routeId });

    const response = await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export?format=gpx`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/gpx\+xml/);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.gpx"$/);
    const text = await response.text();
    expect(trackNames(text)).toEqual(['Ruta ñandú buena']);
    expect(text).not.toContain('Ruta no disponible');
    expect(text).not.toContain('Ruta borrador');
    expect(text).not.toMatch(/<author|<email|<link|@|borrador sin validar/);
    expect(text).toContain('Versión 1, validada');
    const geometry = MissionRouteGeometry.parse(await (await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/${good.missionRouteId}/geometry`)).json());
    expect(trackPoints(text)).toEqual(geometry.geometry.coordinates);
  });

  it('KML on request; GPX by default', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id);
    const kml = await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export?format=kml`);
    expect(kml.status).toBe(200);
    expect(kml.headers.get('content-type')).toMatch(/^application\/vnd\.google-earth\.kml\+xml/);
    expect(await kml.text()).toContain('<kml');
    const byDefault = await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export`);
    expect(byDefault.headers.get('content-type')).toMatch(/^application\/gpx\+xml/);
  });

  it('ids narrows the export to those rows; an unavailable or Draft one asked for by id is still not exported', async () => {
    const mission = await newMission(a.coordinator, true);
    const first = await validatedInMission(a.coordinator, mission.id, {}, 'Primera');
    await validatedInMission(a.coordinator, mission.id, {}, 'Segunda', line(0.7, 42.62));
    const gone = await validatedInMission(a.coordinator, mission.id, {}, 'Tercera', line(0.75, 42.63));
    await patch(a.coordinator, mission.id, gone.missionRouteId, { status: 'unavailable' });

    const only = await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export?ids=${first.missionRouteId}`);
    expect(trackNames(await only.text())).toEqual(['Primera']);
    // Only the unavailable one: nothing left to export.
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export?ids=${gone.missionRouteId}`), 'NOT_FOUND');
  });

  it('a mission without exportable routes is a 404 (nothing to download)', async () => {
    const mission = await newMission(a.coordinator, true);
    const draft = await newRoute(a.coordinator);
    await addRoute(a.coordinator, mission.id, { routeId: draft.routeId });
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export`), 'NOT_FOUND');
  });

  it('a closed mission is read but not exported (MISSION_NOT_ACTIVE); planning and other organizations are 404; the staff are refused', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id);
    expect((await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export`)).status).toBe(200);
    await expectError(await call(b.rescuer, 'GET', `/my/missions/${mission.id}/routes/export`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', `/my/missions/${mission.id}/routes/export`), 'FORBIDDEN');
    await closeMission(a.coordinator, mission.id);
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${mission.id}/routes/export`), 'MISSION_NOT_ACTIVE');
    expect(await mine(a.rescuer, mission.id)).toHaveLength(1);

    const planning = await newMission(a.coordinator);
    await validatedInMission(a.coordinator, planning.id);
    await expectError(await call(a.rescuer, 'GET', `/my/missions/${planning.id}/routes/export`), 'NOT_FOUND');
  });
});

describe('exportMissionRoutes (RF-508, RF-603, P2)', () => {
  it('exports every route in its PINNED version, Drafts included, and leaves the unavailable ones out unless asked by id', async () => {
    const mission = await newMission(a.coordinator);
    const validated = await validatedInMission(a.coordinator, mission.id, {}, 'Validada');
    const v2 = await newVersion(a.coordinator, validated.routeId, validated.versionId, line(0.9, 42.4, 9));
    await validate(a.coordinator, validated.routeId, v2.versionId); // newer than the pinned one
    const draft = await newRoute(a.coordinator, 'Borrador', line(0.8, 42.63));
    await addRoute(a.coordinator, mission.id, { routeId: draft.routeId });
    const off = await validatedInMission(a.coordinator, mission.id, {}, 'No disponible', line(0.7, 42.62));
    await patch(a.coordinator, mission.id, off.missionRouteId, { status: 'unavailable' });

    const response = await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/export`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(trackNames(text)).toEqual(['Validada', 'Borrador']);
    expect(text).toContain('Versión 1, validada');
    expect(text).toContain('Versión 1, borrador sin validar');
    expect(text).not.toMatch(/<author|<email|<link|@/);
    const geometry = MissionRouteGeometry.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/${validated.missionRouteId}/geometry`)).json());
    expect(trackPoints(text).slice(0, geometry.geometry.coordinates.length)).toEqual(geometry.geometry.coordinates);

    // By id, the unavailable one is exported too (the coordinator decides).
    const asked = await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/export?ids=${off.missionRouteId}&format=kml`);
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain('No disponible');
  });

  it('works on a closed mission, for the administrator too; the rescuer is refused', async () => {
    const mission = await newMission(a.coordinator, true);
    await validatedInMission(a.coordinator, mission.id);
    await closeMission(a.coordinator, mission.id);
    expect((await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/export`)).status).toBe(200);
    expect((await call(a.admin, 'GET', `/missions/${mission.id}/routes/export`)).status).toBe(200);
    await expectError(await call(a.rescuer, 'GET', `/missions/${mission.id}/routes/export`), 'FORBIDDEN');
  });

  it('INV-01: another organization is a 404, ids of other missions or organizations are ignored, and an empty mission is a 404', async () => {
    const mission = await newMission(a.coordinator);
    const here = await validatedInMission(a.coordinator, mission.id, {}, 'Aquí');
    const other = await newMission(a.coordinator);
    const elsewhere = await validatedInMission(a.coordinator, other.id, {}, 'Otra misión', line(0.7, 42.62));
    await expectError(await call(b.coordinator, 'GET', `/missions/${mission.id}/routes/export`), 'NOT_FOUND');
    await expectError(await call(b.admin, 'GET', `/missions/${mission.id}/routes/export`), 'NOT_FOUND');

    const text = await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/export?ids=${here.missionRouteId},${elsewhere.missionRouteId}`)).text();
    expect(trackNames(text)).toEqual(['Aquí']);
    await expectError(await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/export?ids=${elsewhere.missionRouteId}`), 'NOT_FOUND');
    const empty = await newMission(a.coordinator);
    await expectError(await call(a.coordinator, 'GET', `/missions/${empty.id}/routes/export`), 'NOT_FOUND');
  });
});
