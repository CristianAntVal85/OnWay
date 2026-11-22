import { randomBytes } from 'node:crypto';
import { ERROR_HTTP, ErrorDetails, ErrorResponse, MissionDetail, MissionPoint, MyMissionDetail, MyMissionsPage, type ErrorCode } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DatabaseService } from '../../src/db/database.service.js';
import { pgErrorOf } from '../../src/db/errors.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { FixedClock } from '../support/clock.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// H1-T3 on real PostGIS: life cycle (activate, close, reopen, duplicate), points, and the rescuer's read-only views.
// Two organizations: B exists only here (the demonstration has one, D-H0-18).
type Mission = z.infer<typeof MissionDetail>;
type Point = z.infer<typeof MissionPoint>;

let app: TestApp;
let fixtures: Fixtures;
let database: DatabaseService;

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member; // complete profile
}
interface OrgA extends Org {
  secondCoordinator: Member;
  incompleteRescuer: Member;
  otherRescuer: Member;
  thirdRescuer: Member;
}

let a: OrgA;
let b: Org;
const sessions = new Map<string, Session>();

const options = { password: TEST_PASSWORD };
const complete = { password: TEST_PASSWORD, profile: 'complete' } as const;

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection });
  database = app.app.get(DatabaseService);
  const orgA = await fixtures.organization('Org A');
  a = {
    orgId: orgA,
    admin: await fixtures.member(orgA, 'admin', 'active', options),
    coordinator: await fixtures.member(orgA, 'coordinator', 'active', options),
    secondCoordinator: await fixtures.member(orgA, 'coordinator', 'active', options),
    rescuer: await fixtures.member(orgA, 'rescuer', 'active', complete),
    incompleteRescuer: await fixtures.member(orgA, 'rescuer', 'active', options),
    otherRescuer: await fixtures.member(orgA, 'rescuer', 'active', complete),
    thirdRescuer: await fixtures.member(orgA, 'rescuer', 'active', complete),
  };
  const orgB = await fixtures.organization('Org B');
  b = {
    orgId: orgB,
    admin: await fixtures.member(orgB, 'admin', 'active', options),
    coordinator: await fixtures.member(orgB, 'coordinator', 'active', options),
    rescuer: await fixtures.member(orgB, 'rescuer', 'active', complete),
  };
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

async function sessionOf(member: Member): Promise<Session> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  return sessions.get(member.userId)!;
}

async function callOn(target: TestApp, member: Member, method: string, path: string, body?: unknown): Promise<Response> {
  const session = target === app ? await sessionOf(member) : await mustLogin(target, member.email, TEST_PASSWORD);
  return fetch(`${target.baseUrl}${path}`, {
    method,
    headers: { ...withSession(session, method !== 'GET'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const call = (member: Member, method: string, path: string, body?: unknown) => callOn(app, member, method, path, body);

async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

const uniq = (label: string) => `${label} ${randomBytes(4).toString('hex')}`;
const inPyrenees = { source: 'map', lat: 42.6, lon: 0.65 } as const;
const newMission = (overrides: Record<string, unknown> = {}) => ({ name: uniq('Mission'), target: inPyrenees, ...overrides });

async function createMission(member: Member, body: Record<string, unknown> = newMission()): Promise<Mission> {
  const response = await call(member, 'POST', '/missions', body);
  expect(response.status).toBe(201);
  return MissionDetail.parse(await response.json());
}
async function parsed(response: Response, status = 200): Promise<Mission> {
  expect(response.status).toBe(status);
  return MissionDetail.parse(await response.json());
}
const activate = async (member: Member, mission: Mission): Promise<Mission> => parsed(await call(member, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true }));
const close = async (member: Member, mission: Mission, attendance: unknown[] = []): Promise<Mission> => parsed(await call(member, 'POST', `/missions/${mission.id}/close`, { attendance }));
const activeMission = async (member: Member = a.coordinator, body: Record<string, unknown> = newMission()) => activate(member, await createMission(member, body));
const closedMission = async (member: Member = a.coordinator) => close(member, await activeMission(member));
const addPoint = async (member: Member, mission: Mission, body: Record<string, unknown>): Promise<Point> => {
  const response = await call(member, 'POST', `/missions/${mission.id}/points`, body);
  expect(response.status).toBe(201);
  return MissionPoint.parse(await response.json());
};
const origin = (name: string, lat = 42.7, lon = 0.4) => ({ kind: 'origin', name, lat, lon });

const auditOf = (missionId: string) =>
  fixtures.query<{ action: string; actor_user_id: string | null; organization_id: string; entity_type: string; entity_id: string; detail: Record<string, unknown> }>(
    `SELECT action, actor_user_id, organization_id, entity_type, entity_id, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`,
    [missionId],
  );
const auditCount = async () => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM audit_log WHERE entity_type = 'mission'`))[0]!.n);
const missionCount = async (orgId: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM missions WHERE organization_id = $1`, [orgId]))[0]!.n);
const rowOf = async (missionId: string) =>
  (
    await fixtures.query<{ status: string; updated_at: Date; activated_at: Date | null; closed_at: Date | null; name: string; coordinator_id: string }>(
      `SELECT status, updated_at, activated_at, closed_at, name, coordinator_id FROM missions WHERE id = $1`,
      [missionId],
    )
  )[0]!;
const pointsOf = (missionId: string) =>
  fixtures.query<{ id: string; kind: string; name: string; position: number; z: number }>(
    `SELECT id, kind::text, name, position, ST_Z(geom) AS z FROM mission_points WHERE mission_id = $1 ORDER BY kind, position`,
    [missionId],
  );

/**
 * A participation made as `onway_owner`: in H1 nobody can offer yet (H6), so the fixture stands in for that. The
 * database insists that a volunteer's offer is born pending (and the mission active); the other states are reached from there.
 */
async function participate(mission: Mission, member: Member, status: 'pending' | 'accepted' | 'withdrawn' | 'not_selected', decidedBy = a.coordinator): Promise<string> {
  if (status === 'accepted') {
    const [row] = await fixtures.query<{ id: string }>(
      `INSERT INTO participations (organization_id, mission_id, user_id, status, origin, decided_by, decided_at) VALUES ($1, $2, $3, 'accepted', 'coordinator', $4, now()) RETURNING id`,
      [member.orgId, mission.id, member.userId, decidedBy.userId],
    );
    return row!.id;
  }
  const [row] = await fixtures.query<{ id: string }>(
    `INSERT INTO participations (organization_id, mission_id, user_id, status, origin, offered_at) VALUES ($1, $2, $3, 'pending', 'volunteer', now()) RETURNING id`,
    [member.orgId, mission.id, member.userId],
  );
  if (status === 'withdrawn') await fixtures.query(`UPDATE participations SET status = 'withdrawn' WHERE id = $1`, [row!.id]);
  if (status === 'not_selected') await fixtures.query(`UPDATE participations SET status = 'not_selected', decided_by = $2, decided_at = now() WHERE id = $1`, [row!.id, decidedBy.userId]);
  return row!.id;
}

/** A validated route pinned to the mission, made as `onway_owner` (routes arrive in H2–H4). */
async function pinRoute(mission: Mission, orgId: string, creator: Member, originPointId: string | null = null): Promise<void> {
  const [route] = await fixtures.query<{ id: string }>(`INSERT INTO routes (organization_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`, [orgId, uniq('Route'), creator.userId]);
  const [version] = await fixtures.query<{ id: string }>(
    `INSERT INTO route_versions (organization_id, route_id, version_number, status, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct, provenance, created_by, validated_by, validated_at)
     VALUES ($1, $2, 1, 'validated', ST_GeomFromEWKT('SRID=4326;LINESTRING Z(0.4 42.7 1000, 0.5 42.65 1100)'), 100, 10, 0, 1000, 1100, 5, 'drawn', $3, $3, now()) RETURNING id`,
    [orgId, route!.id, creator.userId],
  );
  await fixtures.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, origin_point_id, added_by) VALUES ($1, $2, $3, $4, $5, $6)`, [
    orgId,
    mission.id,
    route!.id,
    version!.id,
    originPointId,
    creator.userId,
  ]);
}

describe('activateMission (RF-207, D-H1-04)', () => {
  it('without a validated route it warns with CONFIRMATION_REQUIRED and changes nothing; repeated with the confirmation it activates', async () => {
    const mission = await createMission(a.coordinator);
    const audits = await auditCount();

    const warning = await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, {}), 'CONFIRMATION_REQUIRED');
    expect(ErrorDetails.CONFIRMATION_REQUIRED.parse(warning.details)).toEqual({ warning: 'no_validated_route' });
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: false }), 'CONFIRMATION_REQUIRED');
    expect(await auditCount()).toBe(audits);
    expect((await rowOf(mission.id)).status).toBe('planning');

    const active = await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true }));
    expect(active).toMatchObject({ status: 'active', closedAt: null, actions: { edit: true, activate: false, close: true, reopen: false, duplicate: true } });
    expect(active.activatedAt).not.toBeNull();
    expect(Date.parse(active.updatedAt)).toBeGreaterThanOrEqual(Date.parse(mission.updatedAt));
    expect(await auditOf(mission.id)).toHaveLength(2);
  });

  it('with a validated route pinned it activates at once, without the warning', async () => {
    const mission = await createMission(a.coordinator);
    await pinRoute(mission, a.orgId, a.coordinator);
    const active = await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`));
    expect(active).toMatchObject({ status: 'active', routes: { validated: 1, total: 1 }, readiness: { hasValidatedRoute: true } });
    const rows = await auditOf(mission.id);
    expect(rows.at(-1)).toMatchObject({ action: 'mission_activated', detail: { withoutValidatedRoute: false } });
  });

  it('takes activated_at from the Clock port, and keeps it when the mission is reopened', async () => {
    const clock = new FixedClock(new Date('2031-05-06T07:08:09.000Z'));
    const { app: appConnection } = inject('database');
    const timed = await startApp({ database: appConnection, clock });
    try {
      const mission = MissionDetail.parse(await (await callOn(timed, a.coordinator, 'POST', '/missions', newMission())).json());
      const active = MissionDetail.parse(await (await callOn(timed, a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true })).json());
      expect(active.activatedAt).toBe('2031-05-06T07:08:09.000Z');
      clock.set(new Date('2031-05-07T10:00:00.000Z'));
      const closed = MissionDetail.parse(await (await callOn(timed, a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [] })).json());
      expect(closed.closedAt).toBe('2031-05-07T10:00:00.000Z');
      clock.set(new Date('2031-05-08T10:00:00.000Z'));
      const reopened = MissionDetail.parse(await (await callOn(timed, a.coordinator, 'POST', `/missions/${mission.id}/reopen`)).json());
      expect(reopened).toMatchObject({ status: 'active', activatedAt: '2031-05-06T07:08:09.000Z', closedAt: null });
    } finally {
      await timed.close();
    }
  });
});

describe('INV-11 / RN-09: a closed mission is read-only, except to reopen it', () => {
  it('the transitions that are not allowed answer INVALID_STATE_TRANSITION and leave nothing behind', async () => {
    const planning = await createMission(a.coordinator);
    const active = await activeMission();
    const closed = await closedMission();
    const audits = await auditCount();

    await expectError(await call(a.coordinator, 'POST', `/missions/${planning.id}/close`, { attendance: [] }), 'INVALID_STATE_TRANSITION');
    await expectError(await call(a.coordinator, 'POST', `/missions/${planning.id}/reopen`), 'INVALID_STATE_TRANSITION');
    await expectError(await call(a.coordinator, 'POST', `/missions/${active.id}/activate`, { confirmWithoutValidatedRoute: true }), 'INVALID_STATE_TRANSITION');
    await expectError(await call(a.coordinator, 'POST', `/missions/${active.id}/reopen`), 'INVALID_STATE_TRANSITION');
    await expectError(await call(a.coordinator, 'POST', `/missions/${closed.id}/activate`, { confirmWithoutValidatedRoute: true }), 'INVALID_STATE_TRANSITION');
    await expectError(await call(a.coordinator, 'POST', `/missions/${closed.id}/close`, { attendance: [] }), 'INVALID_STATE_TRANSITION');

    expect(await auditCount()).toBe(audits);
    expect([(await rowOf(planning.id)).status, (await rowOf(active.id)).status, (await rowOf(closed.id)).status]).toEqual(['planning', 'active', 'closed']);
  });

  it('a closed mission refuses updateMission and the three point operations with 409 MISSION_CLOSED, and writes no audit row', async () => {
    const mission = await activeMission();
    const point = await addPoint(a.coordinator, mission, origin('Base'));
    const closed = await close(a.coordinator, mission);
    expect(closed).toMatchObject({ status: 'closed', actions: { edit: false, activate: false, close: false, reopen: true, duplicate: true, manageParticipants: false, manageRoutes: false } });
    expect(closed.closedAt).not.toBeNull();
    const audits = await auditCount();
    const before = await rowOf(mission.id);

    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: uniq('Late') }), 'MISSION_CLOSED');
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/points`, origin('Late')), 'MISSION_CLOSED');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, { name: 'Late' }), 'MISSION_CLOSED');
    await expectError(await call(a.coordinator, 'DELETE', `/missions/${mission.id}/points/${point.id}`), 'MISSION_CLOSED');

    expect(await auditCount()).toBe(audits);
    expect(await rowOf(mission.id)).toEqual(before);
    expect((await pointsOf(mission.id)).map((p) => p.name)).toEqual(['Base']);
  });

  it('reopening answers 200, the mission is active again and accepts writes', async () => {
    const mission = await closedMission();
    const reopened = await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/reopen`));
    expect(reopened).toMatchObject({ status: 'active', closedAt: null, actions: { edit: true, close: true, reopen: false } });
    expect(reopened.activatedAt).toBe(mission.activatedAt);
    expect((await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: 'back' })).status).toBe(200);
    await addPoint(a.coordinator, mission, origin('Base'));
    expect((await auditOf(mission.id)).map((r) => r.action)).toEqual(['mission_created', 'mission_activated', 'mission_closed', 'mission_reopened', 'mission_updated', 'point_added']);
  });

  it('the database says the same in the real context of the coordinator: triggers missions_guard and assert_mission_open', async () => {
    const mission = await activeMission();
    const point = await addPoint(a.coordinator, mission, origin('Base'));
    const planning = await createMission(a.coordinator);
    await close(a.coordinator, mission);
    const context = { orgId: a.orgId, userId: a.coordinator.userId, role: 'coordinator' } as const;
    const failure = async (statement: ReturnType<typeof sql>) => {
      try {
        await database.withContext(context, (tx) => tx.execute(statement));
      } catch (error) {
        return pgErrorOf(error);
      }
      return undefined;
    };

    for (const statement of [
      sql`UPDATE missions SET name = 'Changed' WHERE id = ${mission.id}`,
      sql`INSERT INTO mission_points (organization_id, mission_id, kind, name, geom) VALUES (${a.orgId}, ${mission.id}, 'origin', 'Late', ST_SetSRID(ST_MakePoint(0.4, 42.7, 1000), 4326))`,
      sql`UPDATE mission_points SET name = 'Changed' WHERE id = ${point.id}`,
      sql`DELETE FROM mission_points WHERE id = ${point.id}`,
    ]) {
      expect(await failure(statement)).toMatchObject({ code: '23000', message: expect.stringContaining('INV-11') });
    }
    // Lifecycle: planning cannot jump to closed, and a mission that was activated never goes back to planning.
    expect(await failure(sql`UPDATE missions SET status = 'closed', closed_at = now(), activated_at = now() WHERE id = ${planning.id}`)).toMatchObject({
      code: '23000',
      message: expect.stringContaining('Transición de misión no permitida'),
    });
    // Reopening is the one write a closed mission admits.
    expect(await failure(sql`UPDATE missions SET status = 'active', closed_at = NULL WHERE id = ${mission.id}`)).toBeUndefined();
    expect((await rowOf(mission.id)).status).toBe('active');
  });
});

describe('closeMission (RF-208, D-27, doc 05 §8.2)', () => {
  it('is atomic with the attendance: an incomplete list is ATTENDANCE_INCOMPLETE and writes nothing; a complete one confirms every accepted participant and closes', async () => {
    const mission = await activeMission(a.coordinator, newMission());
    const first = await participate(mission, a.rescuer, 'accepted');
    const second = await participate(mission, a.otherRescuer, 'accepted');
    const pending = await participate(mission, a.thirdRescuer, 'pending');
    const audits = await auditCount();
    const attendanceOf = () =>
      fixtures.query<{ id: string; participated: boolean | null; attendance_confirmed_by: string | null; attendance_confirmed_at: Date | null }>(
        `SELECT id, participated, attendance_confirmed_by, attendance_confirmed_at FROM participations WHERE mission_id = $1 ORDER BY id`,
        [mission.id],
      );

    const none = await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [] }), 'ATTENDANCE_INCOMPLETE');
    expect((ErrorDetails.ATTENDANCE_INCOMPLETE.parse(none.details).missingParticipationIds as string[]).sort()).toEqual([first, second].sort());
    const some = await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [{ participationId: first, participated: true }] }), 'ATTENDANCE_INCOMPLETE');
    expect(ErrorDetails.ATTENDANCE_INCOMPLETE.parse(some.details).missingParticipationIds).toEqual([second]);

    // A pending participation is not an accepted one: naming it is invalid input, and so is repeating one.
    const both = [
      { participationId: first, participated: true },
      { participationId: second, participated: false },
    ];
    const withPending = await expectError(
      await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [...both, { participationId: pending, participated: true }] }),
      'VALIDATION_FAILED',
    );
    expect(ErrorDetails.VALIDATION_FAILED.parse(withPending.details).issues[0]!.path).toBe('attendance.2.participationId');
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [...both, both[0]] }), 'VALIDATION_FAILED');

    expect(await auditCount()).toBe(audits);
    expect((await rowOf(mission.id)).status).toBe('active');
    expect((await attendanceOf()).every((row) => row.participated === null && row.attendance_confirmed_at === null)).toBe(true);

    const closed = await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: both }));
    expect(closed).toMatchObject({ status: 'closed', participants: { accepted: 2, pending: 1 } });
    const rows = Object.fromEntries((await attendanceOf()).map((row) => [row.id, row]));
    expect(rows[first]).toMatchObject({ participated: true, attendance_confirmed_by: a.coordinator.userId });
    expect(rows[second]).toMatchObject({ participated: false, attendance_confirmed_by: a.coordinator.userId });
    expect(rows[pending]).toMatchObject({ participated: null, attendance_confirmed_at: null });
    expect(rows[first]!.attendance_confirmed_at).not.toBeNull();
    expect((await auditOf(mission.id)).at(-1)).toMatchObject({ action: 'mission_closed', detail: { attended: 1, accepted: 2 } });

    // Reopened and closed again, the list is confirmed again (doc 02 §4.5).
    await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/reopen`));
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [] }), 'ATTENDANCE_INCOMPLETE');
    const again = await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: both.map((e) => ({ ...e, participated: true })) }));
    expect(again.status).toBe('closed');
    expect((await attendanceOf()).filter((row) => row.participated === true)).toHaveLength(2);
  });

  it('with no accepted participant, an empty list closes it', async () => {
    const mission = await activeMission();
    const closed = await close(a.coordinator, mission);
    expect(closed.status).toBe('closed');
    expect((await auditOf(mission.id)).at(-1)).toMatchObject({ action: 'mission_closed', detail: { attended: 0, accepted: 0 } });
  });
});

describe('DUPLICATE_NAME on reopen and duplicate (index missions_org_name_open_uq)', () => {
  it('reopening a mission whose name an open mission took meanwhile answers DUPLICATE_NAME and stays closed', async () => {
    const closed = await closedMission();
    await createMission(a.coordinator, newMission({ name: closed.name.toUpperCase() }));
    const audits = await auditCount();
    await expectError(await call(a.coordinator, 'POST', `/missions/${closed.id}/reopen`), 'DUPLICATE_NAME');
    expect((await rowOf(closed.id)).status).toBe('closed');
    expect(await auditCount()).toBe(audits);
  });

  it('duplicating with a name an open mission uses answers DUPLICATE_NAME and creates nothing', async () => {
    const source = await createMission(a.coordinator, newMission());
    const other = await createMission(a.coordinator);
    const missions = await missionCount(a.orgId);
    const audits = await auditCount();
    await expectError(await call(a.coordinator, 'POST', `/missions/${source.id}/duplicate`, { name: other.name.toLowerCase() }), 'DUPLICATE_NAME');
    await expectError(await call(a.coordinator, 'POST', `/missions/${source.id}/duplicate`, { name: source.name }), 'DUPLICATE_NAME');
    expect(await missionCount(a.orgId)).toBe(missions);
    expect(await auditCount()).toBe(audits);
  });
});

describe('duplicateMission (RF-203, D-H1-05)', () => {
  it('makes a mission in planning with the data and points of the original and no participants or teams', async () => {
    const source = await activeMission(a.coordinator, newMission({ description: 'Template', target: { source: 'address', lat: 42.55, lon: 0.8, label: 'Fictitious refuge', country: 'ES' } }));
    await addPoint(a.coordinator, source, origin('Base A'));
    await addPoint(a.coordinator, source, origin('Base B', 42.71, 0.41));
    await addPoint(a.coordinator, source, { kind: 'waypoint', name: 'Gate', lat: 42.6, lon: 0.7, note: 'Open it' });
    await addPoint(a.coordinator, source, { kind: 'rendezvous', name: 'Meeting', lat: 42.62, lon: 0.62 });
    await participate(source, a.rescuer, 'accepted');
    const teamId = await fixtures.team(a.orgId);
    await fixtures.query(`INSERT INTO mission_team_assignments (mission_id, team_id, organization_id, assigned_by) VALUES ($1, $2, $3, $4)`, [source.id, teamId, a.orgId, a.coordinator.userId]);
    const original = await parsed(await call(a.coordinator, 'GET', `/missions/${source.id}`));
    expect(original.teams).toHaveLength(1);
    const sourceAudit = await auditOf(source.id);
    const sourceRow = await rowOf(source.id);

    const name = uniq('Copy');
    const copy = await parsed(await call(a.secondCoordinator, 'POST', `/missions/${source.id}/duplicate`, { name }), 201);
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      name,
      status: 'planning',
      description: 'Template',
      activatedAt: null,
      closedAt: null,
      target: original.target,
      coordinator: original.coordinator,
      teams: [],
      participants: { accepted: 0, pending: 0 },
      routes: { validated: 0, total: 0 },
      actions: { edit: true, activate: true, close: false, reopen: false },
    });
    expect(copy.points.map((p) => [p.kind, p.name, p.position, p.note, p.lat, p.lon, p.elevationM])).toEqual(
      original.points.map((p) => [p.kind, p.name, p.position, p.note, p.lat, p.lon, p.elevationM]),
    );
    expect(copy.points.map((p) => p.id).filter((id) => original.points.some((o) => o.id === id))).toEqual([]);
    expect(copy.origins.map((o) => o.name)).toEqual(['Base A', 'Base B']);

    // The copy is its own mission: it starts with one `mission_created` that says where it came from; the original is untouched.
    expect(await auditOf(copy.id)).toEqual([
      expect.objectContaining({
        action: 'mission_created',
        actor_user_id: a.secondCoordinator.userId,
        organization_id: a.orgId,
        entity_type: 'mission',
        entity_id: copy.id,
        detail: { name, duplicatedFrom: source.id, includeRoutes: true },
      }),
    ]);
    expect(await auditOf(source.id)).toEqual(sourceAudit);
    expect(await rowOf(source.id)).toEqual(sourceRow);
    const participants = await fixtures.query(`SELECT 1 FROM participations WHERE mission_id = $1`, [copy.id]);
    const teams = await fixtures.query(`SELECT 1 FROM mission_team_assignments WHERE mission_id = $1`, [copy.id]);
    expect([participants.length, teams.length]).toEqual([0, 0]);
  });

  it('copies the routes with the same pinned version and their origin mapped to the copied point, unless asked not to', async () => {
    const source = await createMission(a.coordinator);
    const base = await addPoint(a.coordinator, source, origin('Base'));
    await pinRoute(source, a.orgId, a.coordinator, base.id);

    const withRoutes = await parsed(await call(a.coordinator, 'POST', `/missions/${source.id}/duplicate`, { name: uniq('With routes') }), 201);
    expect(withRoutes.routes).toEqual({ validated: 1, total: 1 });
    const copied = await fixtures.query<{ same_version: boolean; origin_point_id: string; status: string }>(
      `SELECT mr.pinned_version_id = o.pinned_version_id AS same_version, mr.origin_point_id, mr.status::text AS status
         FROM mission_routes mr JOIN mission_routes o ON o.mission_id = $2 AND o.route_id = mr.route_id WHERE mr.mission_id = $1`,
      [withRoutes.id, source.id],
    );
    expect(copied).toEqual([{ same_version: true, origin_point_id: withRoutes.points[0]!.id, status: 'added' }]);
    expect(copied[0]!.origin_point_id).not.toBe(base.id);

    const without = await parsed(await call(a.coordinator, 'POST', `/missions/${source.id}/duplicate`, { name: uniq('No routes'), includeRoutes: false }), 201);
    expect(without.routes).toEqual({ validated: 0, total: 0 });
    expect(without.points).toHaveLength(1);
  });

  it('works on a closed mission, and the one who copies is the responsible when the original one is no longer a coordinator', async () => {
    const orgId = await fixtures.organization('Org duplicates');
    const leaver = await fixtures.member(orgId, 'coordinator', 'active', options);
    const stays = await fixtures.member(orgId, 'coordinator', 'active', options);
    const mission = await closedMission(leaver);
    await fixtures.query(`UPDATE memberships SET status = 'disabled' WHERE user_id = $1`, [leaver.userId]);
    const copy = await parsed(await call(stays, 'POST', `/missions/${mission.id}/duplicate`, { name: uniq('From closed') }), 201);
    expect(copy).toMatchObject({ status: 'planning', coordinator: { id: stays.userId } });
  });
});

describe('createMissionPoint / updateMissionPoint / deleteMissionPoint (RF-402, RF-403, RF-404, D-H1-06)', () => {
  it('creates points of the three kinds with the altitude of the server and a position that counts within (mission, kind)', async () => {
    const mission = await createMission(a.coordinator);
    const expected = await new SyntheticElevationProvider().elevationAt({ lat: 42.7, lon: 0.4 });
    const first = await addPoint(a.coordinator, mission, { ...origin('Base'), note: 'Fictitious' });
    expect(first).toEqual({ id: first.id, kind: 'origin', name: 'Base', note: 'Fictitious', lat: 42.7, lon: 0.4, elevationM: expected, position: 0 });
    const second = await addPoint(a.coordinator, mission, origin('Parking', 42.65, 0.5));
    const gate = await addPoint(a.coordinator, mission, { kind: 'waypoint', name: 'Gate', lat: 42.6, lon: 0.7 });
    const meeting = await addPoint(a.coordinator, mission, { kind: 'rendezvous', name: 'Meeting', lat: 42.62, lon: 0.62 });
    expect([second.position, gate.position, meeting.position, gate.note]).toEqual([1, 0, 0, null]);
    expect((await auditOf(mission.id)).map((r) => r.action)).toEqual(['mission_created', 'point_added', 'point_added', 'point_added', 'point_added']);
    expect((await auditOf(mission.id)).at(-1)?.detail).toEqual({ name: 'Meeting', kind: 'rendezvous' });
    const detail = await parsed(await call(a.coordinator, 'GET', `/missions/${mission.id}`));
    expect(detail.points.map((p) => p.name)).toEqual(['Base', 'Parking', 'Gate', 'Meeting']);
    expect(detail.readiness.hasOrigins).toBe(true);
    for (const row of await pointsOf(mission.id)) expect(row.z).toBeGreaterThan(0);
  });

  it('refuses a point with an altitude from the client, an unknown kind, an empty name or no coverage, and leaves no row', async () => {
    const mission = await createMission(a.coordinator);
    const audits = await auditCount();
    for (const body of [{ ...origin('Base'), elevationM: 3000 }, { ...origin('Base'), kind: 'target' }, origin('  '), { kind: 'origin', lat: 42, lon: 0.4 }, { ...origin('Base'), lat: 95 }]) {
      await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/points`, body), 'VALIDATION_FAILED');
    }
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/points`, origin('Far away', 10, 10)), 'OUTSIDE_COVERAGE');
    expect(await pointsOf(mission.id)).toEqual([]);
    expect(await auditCount()).toBe(audits);
  });

  it('updates name and note, recalculates the altitude when the point moves and clears a note with an empty text', async () => {
    const mission = await createMission(a.coordinator);
    const point = await addPoint(a.coordinator, mission, { ...origin('Base'), note: 'Old' });
    const renamed = MissionPoint.parse(await (await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, { name: 'Camp', note: '' })).json());
    expect(renamed).toEqual({ ...point, name: 'Camp', note: null });

    const expected = await new SyntheticElevationProvider().elevationAt({ lat: 42.7, lon: 0.9 });
    const moved = MissionPoint.parse(await (await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, { lon: 0.9 })).json());
    expect(moved).toMatchObject({ lat: 42.7, lon: 0.9, elevationM: expected, name: 'Camp' });
    expect(moved.elevationM).not.toBe(point.elevationM);
    expect((await pointsOf(mission.id))[0]!.z).toBe(expected);

    const audits = await auditOf(mission.id);
    expect(audits.map((r) => r.action)).toEqual(['mission_created', 'point_added', 'point_updated', 'point_updated']);
    expect(audits.at(-2)?.detail).toEqual({ name: 'Camp', fields: ['name', 'note'] });
    expect(audits.at(-1)?.detail).toEqual({ name: 'Camp', fields: ['location'] });

    const before = await auditCount();
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, { lat: 10, lon: 10 }), 'OUTSIDE_COVERAGE');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, {}), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, { elevationM: 5 }), 'VALIDATION_FAILED');
    expect(await auditCount()).toBe(before);
    expect((await pointsOf(mission.id))[0]!.z).toBe(expected);
  });

  it('reorders within the kind keeping positions contiguous, and a change of kind goes to the end of the new list', async () => {
    const mission = await createMission(a.coordinator);
    const one = await addPoint(a.coordinator, mission, origin('One'));
    const two = await addPoint(a.coordinator, mission, origin('Two'));
    const three = await addPoint(a.coordinator, mission, origin('Three'));
    await addPoint(a.coordinator, mission, { kind: 'waypoint', name: 'Gate', lat: 42.6, lon: 0.7 });
    const patch = async (point: Point, body: Record<string, unknown>) => MissionPoint.parse(await (await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, body)).json());
    const layout = async () => (await pointsOf(mission.id)).map((p) => `${p.kind}:${p.name}:${p.position}`);

    expect((await patch(three, { position: 0 })).position).toBe(0);
    expect(await layout()).toEqual(['origin:Three:0', 'origin:One:1', 'origin:Two:2', 'waypoint:Gate:0']);
    expect((await patch(three, { position: 99 })).position).toBe(2); // beyond the end = the end
    expect(await layout()).toEqual(['origin:One:0', 'origin:Two:1', 'origin:Three:2', 'waypoint:Gate:0']);

    const moved = await patch(one, { kind: 'waypoint' });
    expect([moved.kind, moved.position]).toEqual(['waypoint', 1]);
    expect(await layout()).toEqual(['origin:Two:0', 'origin:Three:1', 'waypoint:Gate:0', 'waypoint:One:1']);
    const front = await patch(two, { kind: 'waypoint', position: 0 });
    expect([front.kind, front.position]).toEqual(['waypoint', 0]);
    expect(await layout()).toEqual(['origin:Three:0', 'waypoint:Two:0', 'waypoint:Gate:1', 'waypoint:One:2']);
  });

  it('deletes a point (204), closes the gap in the positions and leaves one audit row; a second delete is a 404', async () => {
    const mission = await createMission(a.coordinator);
    const one = await addPoint(a.coordinator, mission, origin('One'));
    await addPoint(a.coordinator, mission, origin('Two'));
    const three = await addPoint(a.coordinator, mission, origin('Three'));
    const audits = await auditCount();

    const response = await call(a.coordinator, 'DELETE', `/missions/${mission.id}/points/${one.id}`);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect((await pointsOf(mission.id)).map((p) => `${p.name}:${p.position}`)).toEqual(['Two:0', 'Three:1']);
    expect(await auditCount()).toBe(audits + 1);
    expect((await auditOf(mission.id)).at(-1)).toMatchObject({ action: 'point_removed', detail: { name: 'One', kind: 'origin' } });

    await expectError(await call(a.coordinator, 'DELETE', `/missions/${mission.id}/points/${one.id}`), 'NOT_FOUND');
    expect(await auditCount()).toBe(audits + 1);
    expect(three.position).toBe(2);
  });

  it('a point is addressed through its own mission: the point of another mission of the organization is a 404', async () => {
    const mine = await createMission(a.coordinator);
    const other = await createMission(a.coordinator);
    const point = await addPoint(a.coordinator, other, origin('Elsewhere'));
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mine.id}/points/${point.id}`, { name: 'Hijack' }), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'DELETE', `/missions/${mine.id}/points/${point.id}`), 'NOT_FOUND');
    expect((await pointsOf(other.id)).map((p) => p.name)).toEqual(['Elsewhere']);
  });
});

describe('INV-01: another organization sees 404 and changes nothing', () => {
  it('the coordinator of B gets 404 on the seven staff operations of this task over missions of A, and A does not change', async () => {
    const planning = await createMission(a.coordinator);
    const active = await activeMission();
    const closed = await closedMission();
    const point = await addPoint(a.coordinator, active, origin('Base'));
    const watched = [planning, active, closed];
    const snapshot = async () => Promise.all(watched.map(async (m) => ({ row: await rowOf(m.id), audit: await auditOf(m.id), points: await pointsOf(m.id) })));
    const before = await snapshot();
    const missionsOfA = await missionCount(a.orgId);
    const missionsOfB = await missionCount(b.orgId);

    const calls: [string, string, unknown?][] = [
      ['POST', `/missions/${planning.id}/activate`, { confirmWithoutValidatedRoute: true }],
      ['POST', `/missions/${active.id}/close`, { attendance: [] }],
      ['POST', `/missions/${closed.id}/reopen`],
      ['POST', `/missions/${active.id}/duplicate`, { name: uniq('Stolen') }],
      ['POST', `/missions/${active.id}/points`, origin('Intruder')],
      ['PATCH', `/missions/${active.id}/points/${point.id}`, { name: 'Intruder' }],
      ['DELETE', `/missions/${active.id}/points/${point.id}`],
    ];
    for (const [method, path, body] of calls) await expectError(await call(b.coordinator, method, path, body), 'NOT_FOUND');

    expect(await snapshot()).toEqual(before);
    expect(await missionCount(a.orgId)).toBe(missionsOfA);
    expect(await missionCount(b.orgId)).toBe(missionsOfB);
  });

  it('the rescuer of B gets 404 on getMyMission of an active mission of A and sees none of A in listMyMissions', async () => {
    const mineInB = await activeMission(b.coordinator);
    const active = await activeMission();
    const closed = await closedMission();
    await expectError(await call(b.rescuer, 'GET', `/my/missions/${active.id}`), 'NOT_FOUND');
    await expectError(await call(b.rescuer, 'GET', `/my/missions/${closed.id}`), 'NOT_FOUND');
    const list = MyMissionsPage.parse(await (await call(b.rescuer, 'GET', '/my/missions?pageSize=100')).json());
    expect(list.items.map((m) => m.id)).toEqual([mineInB.id]);
    expect(list.total).toBe(1);
  });
});

describe('INV-08 / RN-16: a rescuer does not see missions in planning', () => {
  it('listMyMissions leaves out planning, getMyMission answers 404 for it, and after activating the rescuer sees it', async () => {
    const orgId = await fixtures.organization('Org visibility');
    const coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
    const rescuer = await fixtures.member(orgId, 'rescuer', 'active', complete);
    const planning = await createMission(coordinator, newMission({ name: 'Planning one' }));
    const active = await activeMission(coordinator, newMission({ name: 'Active one' }));
    const closed = await closedMission(coordinator);
    const list = async (query = '') => MyMissionsPage.parse(await (await call(rescuer, 'GET', `/my/missions${query}`)).json());

    const seen = await list();
    expect(seen.items.map((m) => m.id)).toEqual([active.id, closed.id]); // active first, then closed
    expect(seen.items.map((m) => m.status)).toEqual(['active', 'closed']);
    expect(seen.total).toBe(2);
    await expectError(await call(rescuer, 'GET', `/my/missions/${planning.id}`), 'NOT_FOUND');
    expect((await list('?status=closed')).items.map((m) => m.id)).toEqual([closed.id]);
    expect((await list('?q=ACTIVE')).items.map((m) => m.id)).toEqual([active.id]);
    expect(await call(rescuer, 'GET', '/my/missions?status=planning').then((r) => r.status)).toBe(400);
    expect(MyMissionsPage.parse(await (await call(rescuer, 'GET', '/my/missions?pageSize=1&page=2')).json())).toMatchObject({ page: 2, pageSize: 1, total: 2 });

    await activate(coordinator, planning);
    expect((await list()).items.map((m) => m.id).sort()).toEqual([planning.id, active.id, closed.id].sort());
    expect((await call(rescuer, 'GET', `/my/missions/${planning.id}`)).status).toBe(200);
  });

  it('every operation of the staff answers 403 FORBIDDEN to a rescuer, and the staff has no access to /my', async () => {
    const mission = await activeMission();
    const point = await addPoint(a.coordinator, mission, origin('Base'));
    const calls: [string, string, unknown?][] = [
      ['POST', `/missions/${mission.id}/activate`, {}],
      ['POST', `/missions/${mission.id}/close`, { attendance: [] }],
      ['POST', `/missions/${mission.id}/reopen`],
      ['POST', `/missions/${mission.id}/duplicate`, { name: uniq('Nope') }],
      ['POST', `/missions/${mission.id}/points`, origin('Nope')],
      ['PATCH', `/missions/${mission.id}/points/${point.id}`, { name: 'Nope' }],
      ['DELETE', `/missions/${mission.id}/points/${point.id}`],
    ];
    const audits = await auditCount();
    for (const [method, path, body] of calls) await expectError(await call(a.rescuer, method, path, body), 'FORBIDDEN');
    // The administrator reads missions but writes none of this either (Q-14 = no).
    for (const [method, path, body] of calls) await expectError(await call(a.admin, method, path, body), 'FORBIDDEN');
    for (const member of [a.coordinator, a.admin]) {
      await expectError(await call(member, 'GET', '/my/missions'), 'FORBIDDEN');
      await expectError(await call(member, 'GET', `/my/missions/${mission.id}`), 'FORBIDDEN');
    }
    expect(await auditCount()).toBe(audits);
    expect((await rowOf(mission.id)).status).toBe('active');
  });
});

describe('getMyMission and listMyMissions (RF-601, RF-602 without routes)', () => {
  it('shows the points and what the server says about offering, with no personal data of anyone else', async () => {
    const mission = await activeMission(
      a.coordinator,
      newMission({ description: 'For rescuers', target: { source: 'address', lat: 42.55, lon: 0.8, label: 'Fictitious refuge', country: 'ES' }, origins: [{ name: 'Base', lat: 42.7, lon: 0.4 }] }),
    );
    await addPoint(a.coordinator, mission, { kind: 'rendezvous', name: 'Meeting', lat: 42.62, lon: 0.62 });
    await participate(mission, a.otherRescuer, 'accepted'); // somebody else's offer
    const response = await call(a.rescuer, 'GET', `/my/missions/${mission.id}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    const detail = MyMissionDetail.parse(JSON.parse(text));
    expect(detail).toMatchObject({
      id: mission.id,
      name: mission.name,
      description: 'For rescuers',
      status: 'active',
      target: mission.target,
      myParticipation: null,
      canOffer: true,
      canWithdraw: false,
      offerBlockedReason: null,
    });
    expect(detail.points.map((p) => [p.kind, p.name])).toEqual([
      ['origin', 'Base'],
      ['rendezvous', 'Meeting'],
    ]);
    expect(Object.keys(detail).sort()).toEqual([
      'canOffer',
      'canWithdraw',
      'coordinatorAlias',
      'coordinatorName',
      'description',
      'id',
      'myParticipation',
      'name',
      'offerBlockedReason',
      'points',
      'status',
      'target',
    ]);
    expect(text).not.toMatch(/@example\.org|phone|document|participants|teams|routes/i);
    expect(text).not.toContain(a.otherRescuer.userId);

    const list = MyMissionsPage.parse(await (await call(a.rescuer, 'GET', '/my/missions?pageSize=100')).json());
    const item = list.items.find((m) => m.id === mission.id)!;
    expect(item).toMatchObject({ name: mission.name, status: 'active', validatedRoutes: 0, myParticipation: null });
    expect(Object.keys(item).sort()).toEqual(['coordinatorAlias', 'coordinatorName', 'id', 'myParticipation', 'name', 'status', 'target', 'validatedRoutes']);
  });

  it('Q-36, D-E3: the rescuer sees the alias of the responsible, never the name; no alias yet is null', async () => {
    const mission = await activeMission();
    const detail = async () => MyMissionDetail.parse(await (await call(a.rescuer, 'GET', `/my/missions/${mission.id}`)).json());
    expect(await detail()).toMatchObject({ coordinatorName: null, coordinatorAlias: null });
    await fixtures.query(`UPDATE memberships SET alias = 'cooalias ALC' WHERE user_id = $1`, [a.coordinator.userId]);
    expect(await detail()).toMatchObject({ coordinatorName: null, coordinatorAlias: 'cooalias ALC' });
    const list = MyMissionsPage.parse(await (await call(a.rescuer, 'GET', '/my/missions?pageSize=100')).json());
    expect(list.items.find((m) => m.id === mission.id)).toMatchObject({ coordinatorName: null, coordinatorAlias: 'cooalias ALC' });
    expect(JSON.stringify(list)).not.toContain(a.coordinator.email);
  });

  it("canOffer and offerBlockedReason follow the profile, the state of the mission and the rescuer's own offer", async () => {
    const mission = await activeMission();
    const get = async (member: Member, id = mission.id) => MyMissionDetail.parse(await (await call(member, 'GET', `/my/missions/${id}`)).json());

    expect(await get(a.incompleteRescuer)).toMatchObject({ canOffer: false, offerBlockedReason: 'profile_incomplete', canWithdraw: false });

    await participate(mission, a.rescuer, 'pending');
    const pending = await get(a.rescuer);
    expect(pending).toMatchObject({ canOffer: false, offerBlockedReason: 'already_offered', canWithdraw: true });
    expect(pending.myParticipation).toMatchObject({ status: 'pending', decidedAt: null });
    expect(pending.myParticipation!.offeredAt).not.toBeNull();
    expect((await get(a.otherRescuer)).myParticipation).toBeNull();

    // A rejection is final for the rescuer; a withdrawn offer can be made again.
    await participate(mission, a.otherRescuer, 'not_selected');
    expect(await get(a.otherRescuer)).toMatchObject({ canOffer: false, offerBlockedReason: 'already_offered', canWithdraw: false, myParticipation: { status: 'not_selected' } });
    const other = await activeMission();
    await participate(other, a.rescuer, 'withdrawn');
    expect(await get(a.rescuer, other.id)).toMatchObject({ canOffer: true, offerBlockedReason: null, canWithdraw: false, myParticipation: { status: 'withdrawn' } });

    // The list carries only the rescuer's own offer.
    const list = MyMissionsPage.parse(await (await call(a.rescuer, 'GET', '/my/missions?pageSize=100')).json());
    expect(list.items.find((m) => m.id === mission.id)?.myParticipation).toMatchObject({ status: 'pending' });
    const others = MyMissionsPage.parse(await (await call(a.incompleteRescuer, 'GET', '/my/missions?pageSize=100')).json());
    expect(others.items.find((m) => m.id === mission.id)?.myParticipation).toBeNull();
  });

  it('a closed mission cannot be offered to, and counts the validated routes of the pinned versions', async () => {
    const mission = await activeMission();
    await pinRoute(mission, a.orgId, a.coordinator);
    const closed = await close(a.coordinator, mission);
    const detail = MyMissionDetail.parse(await (await call(a.rescuer, 'GET', `/my/missions/${closed.id}`)).json());
    expect(detail).toMatchObject({ status: 'closed', canOffer: false, offerBlockedReason: 'mission_not_active', canWithdraw: false });
    const item = MyMissionsPage.parse(await (await call(a.rescuer, 'GET', '/my/missions?status=closed&pageSize=100')).json()).items.find((m) => m.id === mission.id);
    expect(item).toMatchObject({ status: 'closed', validatedRoutes: 1 });
  });
});

describe('INV-16: every write of H1 leaves exactly one audit row, and a rejected one leaves none', () => {
  it('the nine writes, one after another, each add one row with the action, the actor, the organization and the mission', async () => {
    const expectRow = async (id: string, action: string, detail?: Record<string, unknown>) => {
      const rows = await auditOf(id);
      const last = rows.at(-1)!;
      expect(last).toMatchObject({ action, actor_user_id: a.coordinator.userId, organization_id: a.orgId, entity_type: 'mission', entity_id: id });
      if (detail) expect(last.detail).toEqual(detail);
      return rows.length;
    };

    // 1. createMission
    const totalBefore = await auditCount();
    const mission = await createMission(a.coordinator, newMission());
    expect(await expectRow(mission.id, 'mission_created')).toBe(1);
    // 2. updateMission
    expect((await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: 'x' })).status).toBe(200);
    expect(await expectRow(mission.id, 'mission_updated', { fields: ['description'] })).toBe(2);
    // 3. createMissionPoint
    const point = await addPoint(a.coordinator, mission, origin('Base'));
    expect(await expectRow(mission.id, 'point_added', { name: 'Base', kind: 'origin' })).toBe(3);
    // 4. updateMissionPoint
    expect((await call(a.coordinator, 'PATCH', `/missions/${mission.id}/points/${point.id}`, { name: 'Camp' })).status).toBe(200);
    expect(await expectRow(mission.id, 'point_updated', { name: 'Camp', fields: ['name'] })).toBe(4);
    // 5. deleteMissionPoint
    expect((await call(a.coordinator, 'DELETE', `/missions/${mission.id}/points/${point.id}`)).status).toBe(204);
    expect(await expectRow(mission.id, 'point_removed', { name: 'Camp', kind: 'origin' })).toBe(5);
    // 6. duplicateMission (the row goes to the copy, not to the original)
    const copy = await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/duplicate`, { name: uniq('Copy') }), 201);
    expect(await expectRow(copy.id, 'mission_created', { name: copy.name, duplicatedFrom: mission.id, includeRoutes: true })).toBe(1);
    expect((await auditOf(mission.id)).length).toBe(5);
    // 7. activateMission
    await activate(a.coordinator, mission);
    expect(await expectRow(mission.id, 'mission_activated', { withoutValidatedRoute: true })).toBe(6);
    // 8. closeMission
    await close(a.coordinator, mission);
    expect(await expectRow(mission.id, 'mission_closed', { attended: 0, accepted: 0 })).toBe(7);
    // 9. reopenMission
    await parsed(await call(a.coordinator, 'POST', `/missions/${mission.id}/reopen`));
    expect(await expectRow(mission.id, 'mission_reopened', {})).toBe(8);

    expect(await auditCount()).toBe(totalBefore + 9);
  });

  it('a rejected write leaves no row and a read leaves none either', async () => {
    const mission = await activeMission();
    const point = await addPoint(a.coordinator, mission, origin('Base'));
    const other = await createMission(a.coordinator);
    const closed = await closedMission();
    const audits = await auditCount();

    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/duplicate`, { name: other.name }), 'DUPLICATE_NAME');
    await expectError(await call(a.coordinator, 'POST', `/missions/${other.id}/activate`, {}), 'CONFIRMATION_REQUIRED');
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true }), 'INVALID_STATE_TRANSITION');
    await expectError(await call(a.coordinator, 'POST', `/missions/${closed.id}/points`, origin('Late')), 'MISSION_CLOSED');
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/points`, origin('Far', 10, 10)), 'OUTSIDE_COVERAGE');
    await expectError(await call(a.rescuer, 'DELETE', `/missions/${mission.id}/points/${point.id}`), 'FORBIDDEN');
    await expectError(await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: 'all' }), 'VALIDATION_FAILED');
    await call(a.coordinator, 'GET', `/missions/${mission.id}`);
    await call(a.rescuer, 'GET', `/my/missions/${mission.id}`);
    await call(a.rescuer, 'GET', '/my/missions');
    expect(await auditCount()).toBe(audits);
  });
});
