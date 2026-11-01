import { randomBytes } from 'node:crypto';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, MissionDetail, MissionHistoryPage, MissionPoint, MissionRouteStaff, MissionRoutesStaff, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// addMissionRoutes, updateMissionRoute and removeMissionRoute (H4-T2), and `addToMission` of createRoute and deriveRoute, on real PostGIS:
// INV-13, INV-06, INV-07, INV-11, INV-01, INV-16, INV-03 (Q-14), RN-13, RN-14 and P5 (an unavailable route is not a usable validated one).
let app: TestApp;
let fixtures: Fixtures;
const storage = new InMemoryFileStorage();

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
  app = await startApp({ database: appConnection, files: { storage } });
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
  return parsed.error;
}

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
const line = (lon: number, lat: number, count = 6, step = 0.0012) => ({
  type: 'LineString' as const,
  coordinates: Array.from({ length: count }, (_, i) => [lon + i * step, lat + i * step * 0.75] as [number, number]),
});
const count = async (sql: string, values: unknown[] = []) => Number((await fixtures.query<{ n: string }>(sql, values))[0]!.n);

async function newMission(member: Member): Promise<{ id: string; originId: string }> {
  const response = await call(member, 'POST', '/missions', { name: uniq('Mission'), target: { source: 'map', lat: 42.61, lon: 0.67 } });
  expect(response.status).toBe(201);
  const id = MissionDetail.parse(await response.json()).id;
  const point = await call(member, 'POST', `/missions/${id}/points`, { kind: 'origin', name: 'Origen de prueba', lat: 42.6, lon: 0.65 });
  expect(point.status).toBe(201);
  return { id, originId: MissionPoint.parse(await point.json()).id };
}
async function newRoute(member: Member, name = uniq('Route'), geometry = line(0.65, 42.6)) {
  const response = await call(member, 'POST', '/routes', { source: 'drawn', name, geometry });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
const validate = async (member: Member, routeId: string, versionId: string) =>
  expect((await call(member, 'POST', `/routes/${routeId}/versions/${versionId}/validate`, { acknowledged: true })).status).toBe(200);
async function newVersion(member: Member, routeId: string, baseVersionId: string) {
  const response = await call(member, 'POST', `/routes/${routeId}/versions`, { baseVersionId, geometry: line(0.66, 42.61) });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
const add = (member: Member, missionId: string, items: Record<string, unknown>[]) => call(member, 'POST', `/missions/${missionId}/routes`, { items });
async function added(member: Member, missionId: string, item: Record<string, unknown>) {
  const response = await add(member, missionId, [item]);
  expect(response.status).toBe(201);
  return MissionRoutesStaff.parse(await response.json()).items[0]!;
}
const update = (member: Member, missionId: string, missionRouteId: string, body: unknown) => call(member, 'PATCH', `/missions/${missionId}/routes/${missionRouteId}`, body);
const remove = (member: Member, missionId: string, missionRouteId: string) => call(member, 'DELETE', `/missions/${missionId}/routes/${missionRouteId}`);
async function history(member: Member, missionId: string) {
  const response = await call(member, 'GET', `/missions/${missionId}/history?pageSize=100`);
  expect(response.status).toBe(200);
  return MissionHistoryPage.parse(await response.json()).items;
}
async function closeMission(member: Member, missionId: string) {
  expect((await call(member, 'POST', `/missions/${missionId}/activate`, { confirmWithoutValidatedRoute: true })).status).toBe(200);
  expect((await call(member, 'POST', `/missions/${missionId}/close`, { attendance: [] })).status).toBe(200);
}
const archive = (member: Member, routeId: string) => call(member, 'POST', `/routes/${routeId}/archive`);

describe('addMissionRoutes (RF-513, D-H4-01, D-H4-05)', () => {
  it('pins the last VALIDATED version by default (or the last one when none is validated), with origin, team and note, and says so in the history', async () => {
    const mission = await newMission(a.coordinator);
    const team = await fixtures.team(a.orgId, 'Equipo');
    const validatedFirst = await newRoute(a.coordinator);
    await validate(a.coordinator, validatedFirst.routeId, validatedFirst.versionId);
    const draftSecond = await newVersion(a.coordinator, validatedFirst.routeId, validatedFirst.versionId); // v2 is a Draft: not the default
    const onlyDraft = await newRoute(a.coordinator);

    const response = await add(a.coordinator, mission.id, [
      { routeId: validatedFirst.routeId, originPointId: mission.originId, teamId: team, note: 'Subida por el collado' },
      { routeId: onlyDraft.routeId },
    ]);
    expect(response.status).toBe(201);
    const items = MissionRoutesStaff.parse(await response.json()).items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      routeId: validatedFirst.routeId,
      status: 'added',
      note: 'Subida por el collado',
      origin: { id: mission.originId },
      team: { id: team },
      pinned: { versionId: validatedFirst.versionId, number: 1, status: 'validated' },
    });
    expect(items[0]!.pinned.versionId).not.toBe(draftSecond.versionId);
    expect(items[1]).toMatchObject({ routeId: onlyDraft.routeId, pinned: { versionId: onlyDraft.versionId, status: 'draft' } });

    const lines = (await history(a.coordinator, mission.id)).filter((h) => h.action === 'route_added');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.summary).sort()).toEqual([expect.any(String), expect.any(String)]);
  });

  it('pins the version asked for, a Draft included (the rescuer will not see it)', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    await validate(a.coordinator, route.routeId, route.versionId);
    const v2 = await newVersion(a.coordinator, route.routeId, route.versionId);
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId, versionId: v2.versionId });
    expect(row.pinned).toMatchObject({ versionId: v2.versionId, number: 2, status: 'draft' });
  });

  it('INV-13: the same route twice is ROUTE_ALREADY_IN_MISSION, and a batch with one of them adds none', async () => {
    const mission = await newMission(a.coordinator);
    const first = await newRoute(a.coordinator);
    const second = await newRoute(a.coordinator);
    await added(a.coordinator, mission.id, { routeId: first.routeId });
    const rows = () => count(`SELECT count(*) AS n FROM mission_routes WHERE mission_id = $1`, [mission.id]);
    const audits = () => count(`SELECT count(*) AS n FROM audit_log WHERE entity_id = $1 AND action = 'route_added'`, [mission.id]);
    const before = [await rows(), await audits()];

    await expectError(await add(a.coordinator, mission.id, [{ routeId: second.routeId }, { routeId: first.routeId }]), 'ROUTE_ALREADY_IN_MISSION');
    expect([await rows(), await audits()]).toEqual(before); // atomic: nothing of the batch, rows or history (INV-16)
    await expectError(await add(a.coordinator, mission.id, [{ routeId: second.routeId }, { routeId: second.routeId }]), 'ROUTE_ALREADY_IN_MISSION');
    expect(await rows()).toBe(before[0]);
  });

  it('INV-06: a version of ANOTHER route is a 404, and the composite foreign key refuses it even without the server', async () => {
    const mission = await newMission(a.coordinator);
    const one = await newRoute(a.coordinator);
    const other = await newRoute(a.coordinator);
    await expectError(await add(a.coordinator, mission.id, [{ routeId: one.routeId, versionId: other.versionId }]), 'NOT_FOUND');
    await expect(
      fixtures.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) VALUES ($1, $2, $3, $4, $5)`, [
        a.orgId,
        mission.id,
        one.routeId,
        other.versionId,
        a.coordinator.userId,
      ]),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('an archived route is INVALID_STATE_TRANSITION (P6); to use it, derive it', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    expect((await archive(a.coordinator, route.routeId)).status).toBe(200);
    await expectError(await add(a.coordinator, mission.id, [{ routeId: route.routeId }]), 'INVALID_STATE_TRANSITION');
  });

  it('an origin of another mission, a point that is not an origin, or a team of another organization is a 404', async () => {
    const mission = await newMission(a.coordinator);
    const other = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    await expectError(await add(a.coordinator, mission.id, [{ routeId: route.routeId, originPointId: other.originId }]), 'NOT_FOUND');
    const meeting = await call(a.coordinator, 'POST', `/missions/${mission.id}/points`, { kind: 'rendezvous', name: 'Reunión', lat: 42.6, lon: 0.66 });
    await expectError(await add(a.coordinator, mission.id, [{ routeId: route.routeId, originPointId: MissionPoint.parse(await meeting.json()).id }]), 'NOT_FOUND');
    await expectError(await add(a.coordinator, mission.id, [{ routeId: route.routeId, teamId: await fixtures.team(b.orgId) }]), 'NOT_FOUND');
    expect(await count(`SELECT count(*) AS n FROM mission_routes WHERE mission_id = $1`, [mission.id])).toBe(0);
  });
});

describe('updateMissionRoute (RF-508, RF-518, RF-805, D-H4-02)', () => {
  it('moves the pinned version ONLY when asked (RN-13), says so in the history, and refuses a version of another route', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    await validate(a.coordinator, route.routeId, route.versionId);
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId });
    const v2 = await newVersion(a.coordinator, route.routeId, route.versionId);
    await validate(a.coordinator, route.routeId, v2.versionId);
    // Validating, editing or deriving never moved it: the table only notices.
    const rows = MissionRoutesStaff.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes`)).json()).items;
    expect(rows[0]).toMatchObject({ pinned: { versionId: route.versionId }, newerValidatedVersion: { versionId: v2.versionId } });

    const response = await update(a.coordinator, mission.id, row.id, { pinnedVersionId: v2.versionId });
    expect(response.status).toBe(200);
    expect(MissionRouteStaff.parse(await response.json())).toMatchObject({ pinned: { versionId: v2.versionId, number: 2 }, newerValidatedVersion: null });
    expect((await history(a.coordinator, mission.id)).some((h) => h.action === 'route_version_changed')).toBe(true);

    const stranger = await newRoute(a.coordinator);
    await expectError(await update(a.coordinator, mission.id, row.id, { pinnedVersionId: stranger.versionId }), 'NOT_FOUND');
  });

  it('marks a route unavailable and reactivates it, each with its history line; the same state again writes nothing', async () => {
    const mission = await newMission(a.coordinator);
    const row = await added(a.coordinator, mission.id, { routeId: (await newRoute(a.coordinator)).routeId });
    expect(MissionRouteStaff.parse(await (await update(a.coordinator, mission.id, row.id, { status: 'unavailable' })).json()).status).toBe('unavailable');
    expect(MissionRouteStaff.parse(await (await update(a.coordinator, mission.id, row.id, { status: 'unavailable' })).json()).status).toBe('unavailable');
    expect(MissionRouteStaff.parse(await (await update(a.coordinator, mission.id, row.id, { status: 'added' })).json()).status).toBe('added');
    const actions = (await history(a.coordinator, mission.id)).map((h) => h.action);
    expect(actions.filter((x) => x === 'route_marked_unavailable')).toHaveLength(1);
    expect(actions.filter((x) => x === 'route_reactivated')).toHaveLength(1);
  });

  it('changes and clears the origin, the team and the note (RF-805: the API takes the team; the screen shows it)', async () => {
    const mission = await newMission(a.coordinator);
    const team = await fixtures.team(a.orgId, 'Equipo');
    const row = await added(a.coordinator, mission.id, { routeId: (await newRoute(a.coordinator)).routeId });
    const set = MissionRouteStaff.parse(await (await update(a.coordinator, mission.id, row.id, { originPointId: mission.originId, teamId: team, note: 'Sale a las 6' })).json());
    expect(set).toMatchObject({ origin: { id: mission.originId }, team: { id: team }, note: 'Sale a las 6' });
    const cleared = MissionRouteStaff.parse(await (await update(a.coordinator, mission.id, row.id, { originPointId: null, teamId: null, note: null })).json());
    expect(cleared).toMatchObject({ origin: null, team: null, note: null });
    await expectError(await update(a.coordinator, mission.id, row.id, { teamId: await fixtures.team(b.orgId) }), 'NOT_FOUND');
  });

  it('a mission route of another mission is a 404', async () => {
    const one = await newMission(a.coordinator);
    const other = await newMission(a.coordinator);
    const row = await added(a.coordinator, one.id, { routeId: (await newRoute(a.coordinator)).routeId });
    await expectError(await update(a.coordinator, other.id, row.id, { note: 'x' }), 'NOT_FOUND');
    await expectError(await remove(a.coordinator, other.id, row.id), 'NOT_FOUND');
  });
});

describe('removeMissionRoute (RN-14, INV-07, D-H4-06)', () => {
  it('the route stays in the library; while it is in an open mission it cannot be archived, and once removed it can', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId });
    const refused = await expectError(await archive(a.coordinator, route.routeId), 'ROUTE_IN_USE');
    expect(JSON.stringify(refused.details)).toContain(mission.id);

    expect((await remove(a.coordinator, mission.id, row.id)).status).toBe(204);
    expect(await count(`SELECT count(*) AS n FROM routes WHERE id = $1`, [route.routeId])).toBe(1); // RN-14: never deleted
    expect((await history(a.coordinator, mission.id)).some((h) => h.action === 'route_removed')).toBe(true);
    expect((await archive(a.coordinator, route.routeId)).status).toBe(200);
  });

  it('INV-07: with the mission closed the route can be archived without removing it', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    await added(a.coordinator, mission.id, { routeId: route.routeId });
    await closeMission(a.coordinator, mission.id);
    expect((await archive(a.coordinator, route.routeId)).status).toBe(200);
  });
});

describe('INV-11: a closed mission takes no route writes', () => {
  it('add, update and remove answer MISSION_CLOSED, and nothing changes', async () => {
    const mission = await newMission(a.coordinator);
    const kept = await newRoute(a.coordinator);
    const row = await added(a.coordinator, mission.id, { routeId: kept.routeId });
    const fresh = await newRoute(a.coordinator);
    await closeMission(a.coordinator, mission.id);

    await expectError(await add(a.coordinator, mission.id, [{ routeId: fresh.routeId }]), 'MISSION_CLOSED');
    await expectError(await update(a.coordinator, mission.id, row.id, { note: 'tarde' }), 'MISSION_CLOSED');
    await expectError(await remove(a.coordinator, mission.id, row.id), 'MISSION_CLOSED');
    expect(await count(`SELECT count(*) AS n FROM mission_routes WHERE mission_id = $1`, [mission.id])).toBe(1);
  });
});

describe('INV-01 and INV-03/Q-14: organizations and roles', () => {
  it('everything of organization A is a 404 for organization B in the three operations, and B cannot bring its ids into A', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId });
    await expectError(await add(b.coordinator, mission.id, [{ routeId: route.routeId }]), 'NOT_FOUND');
    await expectError(await update(b.coordinator, mission.id, row.id, { note: 'x' }), 'NOT_FOUND');
    await expectError(await remove(b.coordinator, mission.id, row.id), 'NOT_FOUND');

    // Organization A cannot pin a route of B either.
    const own = await newMission(a.coordinator);
    const theirs = await newRoute(b.coordinator);
    await expectError(await add(a.coordinator, own.id, [{ routeId: theirs.routeId }]), 'NOT_FOUND');
    expect(await count(`SELECT count(*) AS n FROM mission_routes WHERE mission_id = $1`, [mission.id])).toBe(1);
  });

  it('the administrator reads but does not write, and the rescuer has no access (the database repeats it: migration 0011 and its 76 checks)', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId });
    for (const member of [a.admin, a.rescuer]) {
      await expectError(await add(member, mission.id, [{ routeId: route.routeId }]), 'FORBIDDEN');
      await expectError(await update(member, mission.id, row.id, { note: 'x' }), 'FORBIDDEN');
      await expectError(await remove(member, mission.id, row.id), 'FORBIDDEN');
    }
    expect((await call(a.admin, 'GET', `/missions/${mission.id}/routes`)).status).toBe(200);
  });
});

describe('INV-16: every write leaves its line, in the same transaction, without personal data', () => {
  it('the history names the route and never the people or the note', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator, 'Ruta de la historia');
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId, note: 'Texto libre del coordinador' });
    await update(a.coordinator, mission.id, row.id, { status: 'unavailable' });
    await remove(a.coordinator, mission.id, row.id);
    const items = (await history(a.coordinator, mission.id)).filter((h) => h.action.startsWith('route_'));
    expect(items.map((h) => h.action).sort()).toEqual(['route_added', 'route_marked_unavailable', 'route_removed']);
    expect(items.every((h) => h.summary === 'Ruta de la historia')).toBe(true);
    const details = await fixtures.query<{ detail: unknown }>(`SELECT detail FROM audit_log WHERE entity_id = $1 AND action LIKE 'route_%'`, [mission.id]);
    expect(JSON.stringify(details)).not.toContain('Texto libre');
    expect(JSON.stringify(details)).not.toContain(a.coordinator.email);
  });

  it('validating a version that a mission has pinned writes route_version_validated in that mission', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    await added(a.coordinator, mission.id, { routeId: route.routeId });
    await validate(a.coordinator, route.routeId, route.versionId);
    expect((await history(a.coordinator, mission.id)).some((h) => h.action === 'route_version_validated')).toBe(true);
  });
});

describe('P5: an unavailable route does not count as a usable validated one', () => {
  it('activating a mission whose only validated route is unavailable still asks for confirmation; with an available one it does not', async () => {
    const mission = await newMission(a.coordinator);
    const route = await newRoute(a.coordinator);
    await validate(a.coordinator, route.routeId, route.versionId);
    const row = await added(a.coordinator, mission.id, { routeId: route.routeId });
    await update(a.coordinator, mission.id, row.id, { status: 'unavailable' });
    const detail = async () => MissionDetail.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}`)).json());
    expect((await detail()).readiness.hasValidatedRoute).toBe(false);
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: false }), 'CONFIRMATION_REQUIRED');

    await update(a.coordinator, mission.id, row.id, { status: 'added' });
    expect((await detail()).readiness.hasValidatedRoute).toBe(true);
    expect((await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: false })).status).toBe(200);
  });
});

describe('addToMission of createRoute and deriveRoute (RF-513: a new route made from the mission is added when it is saved)', () => {
  it('createRoute pins version 1 with the origin and the team, answers with missionRouteId and writes route_added', async () => {
    const mission = await newMission(a.coordinator);
    const team = await fixtures.team(a.orgId);
    const response = await call(a.coordinator, 'POST', '/routes', {
      source: 'drawn',
      name: uniq('Desde la misión'),
      geometry: line(0.65, 42.6),
      addToMission: { missionId: mission.id, originPointId: mission.originId, teamId: team },
    });
    expect(response.status).toBe(201);
    const created = CreatedRoute.parse(await response.json());
    expect(created.missionRouteId).not.toBeNull();
    const [row] = MissionRoutesStaff.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes`)).json()).items;
    expect(row).toMatchObject({ id: created.missionRouteId, routeId: created.routeId, pinned: { versionId: created.versionId, number: 1 }, origin: { id: mission.originId }, team: { id: team } });
    expect((await history(a.coordinator, mission.id)).filter((h) => h.action === 'route_added')).toHaveLength(1);
  });

  it('deriveRoute adds the copy, not the source', async () => {
    const mission = await newMission(a.coordinator);
    const source = await newRoute(a.coordinator);
    const response = await call(a.coordinator, 'POST', `/routes/${source.routeId}/derive`, { name: uniq('Copia'), fromVersionId: source.versionId, addToMission: { missionId: mission.id } });
    expect(response.status).toBe(201);
    const derived = CreatedRoute.parse(await response.json());
    const rows = MissionRoutesStaff.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/routes`)).json()).items;
    expect(rows.map((r) => r.routeId)).toEqual([derived.routeId]);
  });

  it('a closed mission, or an origin or team that is not there, is refused BEFORE the route is made: no route, no row', async () => {
    const closed = await newMission(a.coordinator);
    await closeMission(a.coordinator, closed.id);
    const open = await newMission(a.coordinator);
    const routes = () => count(`SELECT count(*) AS n FROM routes WHERE organization_id = $1`, [a.orgId]);
    const before = await routes();
    const create = (addToMission: Record<string, unknown>) => call(a.coordinator, 'POST', '/routes', { source: 'drawn', name: uniq('Nope'), geometry: line(0.65, 42.6), addToMission });

    await expectError(await create({ missionId: closed.id }), 'MISSION_CLOSED');
    await expectError(await create({ missionId: open.id, originPointId: closed.originId }), 'NOT_FOUND');
    await expectError(await create({ missionId: open.id, teamId: await fixtures.team(b.orgId) }), 'NOT_FOUND');
    await expectError(await create({ missionId: (await newMission(b.coordinator)).id }), 'NOT_FOUND');
    expect(await routes()).toBe(before);
  });
});
