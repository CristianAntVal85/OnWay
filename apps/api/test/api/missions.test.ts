import { randomBytes, randomUUID } from 'node:crypto';
import { ERROR_HTTP, ErrorDetails, ErrorResponse, MissionDetail, MissionHistoryPage, MissionsPage, type ErrorCode } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DatabaseService } from '../../src/db/database.service.js';
import { pgErrorOf } from '../../src/db/errors.js';
import { SyntheticElevationProvider } from '../../src/geo/synthetic-elevation.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// Two organizations on real PostGIS. A has an admin, two coordinators, a rescuer and a disabled coordinator; B has the
// same minimum. B exists only here: the demonstration has one organization (D-H0-18).
type Mission = z.infer<typeof MissionDetail>;

let app: TestApp;
let fixtures: Fixtures;
let database: DatabaseService;

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
}
interface OrgA extends Org {
  secondCoordinator: Member;
  disabledCoordinator: Member;
}

let a: OrgA;
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
  app = await startApp({ database: appConnection });
  database = app.app.get(DatabaseService);
  const base = await build('Org A');
  a = {
    ...base,
    secondCoordinator: await fixtures.member(base.orgId, 'coordinator', 'active', options),
    disabledCoordinator: await fixtures.member(base.orgId, 'coordinator', 'disabled', options),
  };
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
const inPyrenees = { source: 'map', lat: 42.6, lon: 0.65 } as const;
const newMission = (overrides: Record<string, unknown> = {}) => ({ name: uniq('Mission'), target: inPyrenees, ...overrides });

async function createMission(member: Member, body: Record<string, unknown> = newMission()): Promise<Mission> {
  const response = await call(member, 'POST', '/missions', body);
  expect(response.status).toBe(201);
  return MissionDetail.parse(await response.json());
}

/** Moves a mission through the lifecycle as `onway_owner`, the way T3's operations will (activate, close). */
async function setStatus(missionId: string, status: 'active' | 'closed'): Promise<void> {
  await fixtures.query(`UPDATE missions SET status = 'active', activated_at = COALESCE(activated_at, now()), closed_at = NULL WHERE id = $1`, [missionId]);
  if (status === 'closed') await fixtures.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [missionId]);
}

const auditOf = (missionId: string) =>
  fixtures.query<{ action: string; actor_user_id: string | null; organization_id: string; entity_type: string; detail: Record<string, unknown> }>(
    `SELECT action, actor_user_id, organization_id, entity_type, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`,
    [missionId],
  );
const auditCount = async () => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM audit_log WHERE entity_type = 'mission'`))[0]!.n);
const missionCount = async () => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM missions`))[0]!.n);

describe('createMission: INV-02 and RN-07 (a mission needs a name, a coordinator and a target)', () => {
  it('with only a name and a target it answers 201: planning, the creator as coordinator, altitude calculated by the server', async () => {
    const expected = await new SyntheticElevationProvider().elevationAt({ lat: inPyrenees.lat, lon: inPyrenees.lon });
    const body = newMission({ target: { ...inPyrenees, label: 'Ficticious ridge', country: 'ES' } });
    const response = await call(a.coordinator, 'POST', '/missions', body);
    expect(response.status).toBe(201);
    const mission = MissionDetail.parse(await response.json());

    expect(mission).toMatchObject({
      name: body.name,
      status: 'planning',
      coordinator: { id: a.coordinator.userId },
      target: { lat: 42.6, lon: 0.65, elevationM: expected, label: 'Ficticious ridge', country: 'ES', source: 'map' },
      origins: [],
      points: [],
      description: null,
      activatedAt: null,
      closedAt: null,
      routes: { validated: 0, total: 0 },
      participants: { accepted: 0, pending: 0 },
      readiness: { targetDefined: true, hasOrigins: false, hasParticipants: false, hasValidatedRoute: false },
      actions: { edit: true, activate: true, close: false, reopen: false, duplicate: true },
    });
    expect(typeof expected).toBe('number');

    // The target is stored as a PointZ with the altitude of the server (INV-02).
    const [row] = await fixtures.query<{ type: string; dims: number; z: number; org: string }>(
      `SELECT GeometryType(target) AS type, ST_NDims(target) AS dims, ST_Z(target) AS z, organization_id AS org FROM missions WHERE id = $1`,
      [mission.id],
    );
    expect(row).toEqual({ type: 'POINT', dims: 3, z: expected, org: a.orgId });
  });

  it('with origins it stores them as origin points with their own altitude, in order', async () => {
    const mission = await createMission(
      a.coordinator,
      newMission({
        origins: [
          { name: 'Base camp', lat: 42.7, lon: 0.4, note: 'Fictitious' },
          { name: 'Parking', lat: 42.65, lon: 0.5 },
        ],
      }),
    );
    expect(mission.origins.map((o) => o.name)).toEqual(['Base camp', 'Parking']);
    expect(mission.points.map((p) => [p.kind, p.name, p.position])).toEqual([
      ['origin', 'Base camp', 0],
      ['origin', 'Parking', 1],
    ]);
    for (const p of mission.points) expect(p.elevationM).toBeGreaterThan(0);
    expect(mission.readiness.hasOrigins).toBe(true);
    // One audit row for the whole creation, whatever the origins.
    expect(await auditOf(mission.id)).toHaveLength(1);
  });

  it('without a target, with a name outside 3–120 characters or with an altitude from the client it answers VALIDATION_FAILED and writes nothing', async () => {
    const missions = await missionCount();
    const audits = await auditCount();
    const bad = [
      { name: uniq('No target') },
      newMission({ name: 'ab' }),
      newMission({ name: 'x'.repeat(121) }),
      newMission({ name: '   ' }),
      newMission({ target: { ...inPyrenees, elevationM: 3000 } }),
      newMission({ elevationM: 3000 }),
      newMission({ target: { source: 'address', lat: 42.6, lon: 0.65 } }),
      newMission({ target: { source: 'map', lat: 95, lon: 0.65 } }),
    ];
    for (const body of bad) {
      const error = await expectError(await call(a.coordinator, 'POST', '/missions', body), 'VALIDATION_FAILED');
      expect(ErrorDetails.VALIDATION_FAILED.parse(error.details).issues.length).toBeGreaterThan(0);
    }
    expect(await missionCount()).toBe(missions);
    expect(await auditCount()).toBe(audits);
  });

  it('a point outside every elevation source answers 422 OUTSIDE_COVERAGE and writes nothing, for the target and for an origin', async () => {
    const missions = await missionCount();
    const audits = await auditCount();
    await expectError(await call(a.coordinator, 'POST', '/missions', newMission({ target: { source: 'map', lat: 10, lon: 10 } })), 'OUTSIDE_COVERAGE');
    await expectError(await call(a.coordinator, 'POST', '/missions', newMission({ origins: [{ name: 'Far away', lat: -30, lon: 100 }] })), 'OUTSIDE_COVERAGE');
    expect(await missionCount()).toBe(missions);
    expect(await auditCount()).toBe(audits);
  });

  it('teamIds, rescuerIds and routes are refused with an issue on each field while their milestones are not built (P4 a)', async () => {
    const missions = await missionCount();
    const error = await expectError(
      await call(a.coordinator, 'POST', '/missions', newMission({ teamIds: [randomUUID()], rescuerIds: [randomUUID()], routes: [{ routeId: randomUUID() }] })),
      'VALIDATION_FAILED',
    );
    expect(
      ErrorDetails.VALIDATION_FAILED.parse(error.details)
        .issues.map((i) => i.path)
        .sort(),
    ).toEqual(['rescuerIds', 'routes', 'teamIds']);
    // Empty lists, which is what the form sends, are fine.
    await createMission(a.coordinator, newMission({ teamIds: [], rescuerIds: [], routes: [] }));
    expect(await missionCount()).toBe(missions + 1);
  });
});

describe('INV-03: the responsible coordinator', () => {
  it('a rescuer, an administrator, a coordinator of another organization, a disabled one and a stranger all give the same VALIDATION_FAILED', async () => {
    const candidates = [a.rescuer.userId, a.admin.userId, b.coordinator.userId, a.disabledCoordinator.userId, randomUUID()];
    const answers = [];
    for (const coordinatorId of candidates) {
      const error = await expectError(await call(a.coordinator, 'POST', '/missions', newMission({ coordinatorId })), 'VALIDATION_FAILED');
      answers.push({ message: error.message, details: error.details });
    }
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(ErrorDetails.VALIDATION_FAILED.parse(answers[0]!.details).issues.map((i) => i.path)).toEqual(['coordinatorId']);
  });

  it('the same candidates are refused when editing, and the mission does not change', async () => {
    const mission = await createMission(a.coordinator);
    for (const coordinatorId of [a.rescuer.userId, a.admin.userId, b.coordinator.userId, a.disabledCoordinator.userId]) {
      await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { coordinatorId }), 'VALIDATION_FAILED');
    }
    const [row] = await fixtures.query<{ coordinator_id: string }>(`SELECT coordinator_id FROM missions WHERE id = $1`, [mission.id]);
    expect(row!.coordinator_id).toBe(a.coordinator.userId);
    expect(await auditOf(mission.id)).toHaveLength(1);
  });

  it('another active coordinator of the organization is accepted, on create and on update', async () => {
    const created = await createMission(a.coordinator, newMission({ coordinatorId: a.secondCoordinator.userId }));
    expect(created.coordinator?.id).toBe(a.secondCoordinator.userId);

    const mission = await createMission(a.coordinator);
    const response = await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { coordinatorId: a.secondCoordinator.userId });
    expect(response.status).toBe(200);
    expect(MissionDetail.parse(await response.json()).coordinator?.id).toBe(a.secondCoordinator.userId);
  });

  it('the database trigger is the second defence: in the real context a rescuer cannot be the responsible', async () => {
    const insertWith = (coordinatorId: string) =>
      database.withContext({ orgId: a.orgId, userId: a.coordinator.userId, role: 'coordinator' }, (tx) =>
        tx.execute(sql`INSERT INTO missions (organization_id, name, coordinator_id, target, target_source, created_by)
                       VALUES (${a.orgId}, ${uniq('Direct')}, ${coordinatorId}, ST_SetSRID(ST_MakePoint(0.6, 42.6, 1000), 4326), 'map', ${a.coordinator.userId})`),
      );
    const failure = await insertWith(a.rescuer.userId).catch((error: unknown) => pgErrorOf(error));
    expect(failure).toMatchObject({ code: '23000' });
    expect((failure as { message: string }).message).toContain('INV-03');
    await expect(insertWith(a.secondCoordinator.userId)).resolves.toBeDefined();
  });
});

describe('INV-01 by id through the API (the first resource with an id)', () => {
  it('the coordinator of B gets 404 on getMission, updateMission and listMissionHistory of a mission of A, and nothing changes in A', async () => {
    const mission = await createMission(a.coordinator);
    const updatedBefore = (await fixtures.query<{ updated_at: Date }>(`SELECT updated_at FROM missions WHERE id = $1`, [mission.id]))[0]!.updated_at.getTime();
    const auditBefore = await auditOf(mission.id);
    const audits = await auditCount();

    await expectError(await call(b.coordinator, 'GET', `/missions/${mission.id}`), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'PATCH', `/missions/${mission.id}`, { name: 'Hijacked' }), 'NOT_FOUND');
    await expectError(await call(b.coordinator, 'GET', `/missions/${mission.id}/history`), 'NOT_FOUND');
    // The administrator of B has no more reach than the coordinator.
    await expectError(await call(b.admin, 'GET', `/missions/${mission.id}`), 'NOT_FOUND');
    await expectError(await call(b.admin, 'GET', `/missions/${mission.id}/history`), 'NOT_FOUND');

    const [after] = await fixtures.query<{ name: string; updated_at: Date }>(`SELECT name, updated_at FROM missions WHERE id = $1`, [mission.id]);
    expect(after!.name).toBe(mission.name);
    expect(after!.updated_at.getTime()).toBe(updatedBefore);
    expect(await auditOf(mission.id)).toEqual(auditBefore);
    expect(await auditCount()).toBe(audits);
  });

  it('the 404 of another organization is identical to the 404 of an id that does not exist', async () => {
    const mission = await createMission(a.coordinator);
    const foreign = await expectError(await call(b.coordinator, 'GET', `/missions/${mission.id}`), 'NOT_FOUND');
    const missing = await expectError(await call(b.coordinator, 'GET', `/missions/${randomUUID()}`), 'NOT_FOUND');
    expect({ ...foreign, requestId: '' }).toEqual({ ...missing, requestId: '' });
  });

  it('listMissions of B contains none of A, and the other way round', async () => {
    const missionA = await createMission(a.coordinator);
    const missionB = await createMission(b.coordinator);
    const listOfB = MissionsPage.parse(await (await call(b.coordinator, 'GET', '/missions?pageSize=200')).json());
    expect(listOfB.items.map((m) => m.id)).toContain(missionB.id);
    expect(listOfB.items.map((m) => m.id)).not.toContain(missionA.id);
    const listOfA = MissionsPage.parse(await (await call(a.coordinator, 'GET', '/missions?pageSize=200')).json());
    expect(listOfA.items.map((m) => m.id)).toContain(missionA.id);
    expect(listOfA.items.map((m) => m.id)).not.toContain(missionB.id);
    // The filter by coordinator does not cross organizations either.
    const crossing = MissionsPage.parse(await (await call(b.coordinator, 'GET', `/missions?coordinatorId=${a.coordinator.userId}`)).json());
    expect(crossing).toMatchObject({ items: [], total: 0 });
  });

  it('in the real context of B (connection onway_app) the missions, points and mission rows of A are not there; writing into A fails', async () => {
    const mission = await createMission(a.coordinator, newMission({ origins: [{ name: 'Base', lat: 42.7, lon: 0.4 }] }));
    const seen = await database.withContext({ orgId: b.orgId, userId: b.coordinator.userId, role: 'coordinator' }, async (tx) => ({
      missions: (await tx.execute(sql`SELECT id FROM missions WHERE id = ${mission.id}`)).rows.length,
      points: (await tx.execute(sql`SELECT id FROM mission_points WHERE mission_id = ${mission.id}`)).rows.length,
      audit: (await tx.execute(sql`SELECT id FROM audit_log WHERE entity_id = ${mission.id}`)).rows.length,
      updated: (await tx.execute(sql`UPDATE missions SET name = 'Hijacked' WHERE id = ${mission.id} RETURNING id`)).rows.length,
    }));
    expect(seen).toEqual({ missions: 0, points: 0, audit: 0, updated: 0 });
  });
});

describe('INV-16: every write leaves exactly one audit row, and a rejected write leaves none', () => {
  it('create and update leave one row each with the action, the actor and the mission, in the same organization', async () => {
    const mission = await createMission(a.coordinator, newMission({ description: 'A note' }));
    let rows = await auditOf(mission.id);
    expect(rows).toEqual([{ action: 'mission_created', actor_user_id: a.coordinator.userId, organization_id: a.orgId, entity_type: 'mission', detail: { name: mission.name, origins: 0 } }]);

    const response = await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: uniq('Renamed'), description: null, target: { source: 'coordinates', lat: 42.55, lon: 0.7 } });
    expect(response.status).toBe(200);
    rows = await auditOf(mission.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      action: 'mission_updated',
      actor_user_id: a.coordinator.userId,
      organization_id: a.orgId,
      entity_type: 'mission',
      detail: { fields: ['name', 'description', 'target'] },
    });
  });

  it('reads leave no audit row', async () => {
    const mission = await createMission(a.coordinator);
    await call(a.coordinator, 'GET', `/missions/${mission.id}`);
    await call(a.coordinator, 'GET', '/missions');
    await call(a.coordinator, 'GET', `/missions/${mission.id}/history`);
    await call(a.admin, 'GET', `/missions/${mission.id}`);
    expect(await auditOf(mission.id)).toHaveLength(1);
  });

  it('a rejected write (duplicate name, stale edit, outside coverage, invalid body, forbidden role) leaves no row and changes nothing', async () => {
    const mission = await createMission(a.coordinator);
    const other = await createMission(a.coordinator);
    const audits = await auditCount();
    const updatedAt = (await fixtures.query<{ u: Date }>(`SELECT updated_at AS u FROM missions WHERE id = $1`, [mission.id]))[0]!.u.getTime();

    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: other.name }), 'DUPLICATE_NAME');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: 'New name', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }), 'STALE_RESOURCE');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { target: { source: 'map', lat: 10, lon: 10 } }), 'OUTSIDE_COVERAGE');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: 'x' }), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, {}), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'POST', '/missions', newMission({ name: other.name })), 'DUPLICATE_NAME');
    await expectError(await call(a.rescuer, 'PATCH', `/missions/${mission.id}`, { name: 'Nope' }), 'FORBIDDEN');
    await expectError(await call(a.admin, 'PATCH', `/missions/${mission.id}`, { name: 'Nope' }), 'FORBIDDEN');
    await expectError(await call(a.admin, 'POST', '/missions', newMission()), 'FORBIDDEN');

    expect(await auditCount()).toBe(audits);
    expect(await auditOf(mission.id)).toHaveLength(1);
    const [row] = await fixtures.query<{ name: string; u: Date }>(`SELECT name, updated_at AS u FROM missions WHERE id = $1`, [mission.id]);
    expect(row).toMatchObject({ name: mission.name });
    expect(row!.u.getTime()).toBe(updatedAt);
  });

  it('listMissionHistory returns the rows newest first, with the actor and a short summary, and no personal data', async () => {
    const mission = await createMission(a.coordinator, newMission({ origins: [{ name: 'Base', lat: 42.7, lon: 0.4 }] }));
    expect((await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: 'first' })).status).toBe(200);
    expect((await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: uniq('Second'), coordinatorId: a.secondCoordinator.userId })).status).toBe(200);

    const response = await call(a.admin, 'GET', `/missions/${mission.id}/history`);
    expect(response.status).toBe(200);
    const text = await response.text();
    const page = MissionHistoryPage.parse(JSON.parse(text));
    expect(page).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(page.items.map((i) => i.action)).toEqual(['mission_updated', 'mission_updated', 'mission_created']);
    expect(page.items.map((i) => i.summary)).toEqual(['name, coordinatorId', 'description', mission.name]);
    expect(page.items.every((i) => i.actor?.id === a.coordinator.userId && i.actor.displayName === 'Fictitious coordinator')).toBe(true);
    const ids = page.items.map((i) => i.id);
    expect(ids).toEqual([...ids].sort((x, y) => y - x));
    const times = page.items.map((i) => Date.parse(i.occurredAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    // Whatever the response says about people is a name: no email, phone, document or address anywhere in it.
    expect(text).not.toMatch(/@example\.org|phone|document|address/i);
    expect(Object.keys(page.items[0]!).sort()).toEqual(['action', 'actor', 'id', 'occurredAt', 'summary']);

    const paged = MissionHistoryPage.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}/history?page=2&pageSize=2`)).json());
    expect(paged).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(paged.items.map((i) => i.action)).toEqual(['mission_created']);
  });

  it('the history shows only the rows of that mission', async () => {
    const one = await createMission(a.coordinator);
    const two = await createMission(a.coordinator);
    await call(a.coordinator, 'PATCH', `/missions/${two.id}`, { description: 'x' });
    const page = MissionHistoryPage.parse(await (await call(a.coordinator, 'GET', `/missions/${one.id}/history`)).json());
    expect(page.items.map((i) => i.action)).toEqual(['mission_created']);
  });
});

describe('DUPLICATE_NAME (index missions_org_name_open_uq, doc 02 §3.4)', () => {
  it('create and update refuse a name already used by an open mission of the organization, whatever its case', async () => {
    const first = await createMission(a.coordinator);
    await expectError(await call(a.coordinator, 'POST', '/missions', newMission({ name: first.name.toUpperCase() })), 'DUPLICATE_NAME');
    const second = await createMission(a.coordinator);
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${second.id}`, { name: first.name.toLowerCase() }), 'DUPLICATE_NAME');
    // Renaming a mission to its own name is not a clash.
    expect((await call(a.coordinator, 'PATCH', `/missions/${first.id}`, { name: first.name })).status).toBe(200);
  });

  it('a closed mission frees its name, and another organization may use the same name', async () => {
    const first = await createMission(a.coordinator);
    const inB = await call(b.coordinator, 'POST', '/missions', newMission({ name: first.name }));
    expect(inB.status).toBe(201);
    await setStatus(first.id, 'closed');
    await createMission(a.coordinator, newMission({ name: first.name }));
  });
});

describe('STALE_RESOURCE (Q-10)', () => {
  it('an edit over a newer version answers 409 with currentUpdatedAt; with the current one it succeeds', async () => {
    const mission = await createMission(a.coordinator);
    const edited = MissionDetail.parse(await (await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: 'by someone else' })).json());
    expect(edited.updatedAt).not.toBe(mission.updatedAt);

    const error = await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: 'mine', expectedUpdatedAt: mission.updatedAt }), 'STALE_RESOURCE');
    expect(ErrorDetails.STALE_RESOURCE.parse(error.details)).toEqual({ currentUpdatedAt: edited.updatedAt });

    const ok = await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: 'mine', expectedUpdatedAt: edited.updatedAt });
    expect(ok.status).toBe(200);
    expect(MissionDetail.parse(await ok.json()).description).toBe('mine');
  });
});

describe('updateMission', () => {
  it('changes only what is sent, recalculates the altitude of a new target and keeps the rest', async () => {
    const mission = await createMission(a.coordinator, newMission({ description: 'keep me' }));
    const moved = { source: 'address', lat: 42.5, lon: 0.9, label: 'Fictitious refuge', country: 'ES' } as const;
    const expected = await new SyntheticElevationProvider().elevationAt({ lat: 42.5, lon: 0.9 });
    const response = await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { target: moved });
    expect(response.status).toBe(200);
    const updated = MissionDetail.parse(await response.json());
    expect(updated.target).toEqual({ lat: 42.5, lon: 0.9, elevationM: expected, label: 'Fictitious refuge', country: 'ES', source: 'address' });
    expect(updated.name).toBe(mission.name);
    expect(updated.description).toBe('keep me');

    const cleared = MissionDetail.parse(await (await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { description: null })).json());
    expect(cleared.description).toBeNull();
  });

  it('a closed mission refuses the edit with 409 MISSION_CLOSED and leaves no row (INV-11)', async () => {
    const mission = await createMission(a.coordinator);
    await setStatus(mission.id, 'closed');
    const audits = await auditCount();
    await expectError(await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: uniq('Late') }), 'MISSION_CLOSED');
    expect(await auditCount()).toBe(audits);
    const detail = MissionDetail.parse(await (await call(a.coordinator, 'GET', `/missions/${mission.id}`)).json());
    expect(detail.status).toBe('closed');
    expect(detail.actions).toEqual({ edit: false, activate: false, close: false, reopen: true, duplicate: true, manageParticipants: false, manageRoutes: false });
  });
});

describe('Q-14 = no: the administrator reads missions and never writes them, in the API and in the database (migration 0011)', () => {
  it('answers 403 to createMission and 200 to listMissions, getMission and listMissionHistory for the administrator; the coordinator creates and edits', async () => {
    const mission = await createMission(a.coordinator);
    const missions = await call(a.admin, 'GET', '/missions');
    expect(missions.status).toBe(200);
    expect(MissionsPage.parse(await missions.json()).items.map((m) => m.id)).toContain(mission.id);
    expect((await call(a.admin, 'GET', `/missions/${mission.id}`)).status).toBe(200);
    expect((await call(a.admin, 'GET', `/missions/${mission.id}/history`)).status).toBe(200);
    await expectError(await call(a.admin, 'POST', '/missions', newMission()), 'FORBIDDEN');

    const renamed = uniq('Renamed');
    expect((await call(a.coordinator, 'PATCH', `/missions/${mission.id}`, { name: renamed })).status).toBe(200);
    expect(MissionDetail.parse(await (await call(a.admin, 'GET', `/missions/${mission.id}`)).json()).name).toBe(renamed);
  });

  it('even with the server check out of the way, the database refuses the administrator: no write reaches missions', async () => {
    const mission = await createMission(a.coordinator);
    const asAdmin = (statement: ReturnType<typeof sql>) => database.withContext({ orgId: a.orgId, userId: a.admin.userId, role: 'admin' }, (tx) => tx.execute(statement));
    await expect(asAdmin(sql`UPDATE missions SET name = 'Hijacked' WHERE id = ${mission.id}`)).resolves.toMatchObject({ rowCount: 0 });
    await expect(asAdmin(sql`DELETE FROM missions WHERE id = ${mission.id}`)).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      asAdmin(
        sql`INSERT INTO missions (organization_id, name, coordinator_id, target, target_source, created_by) VALUES (${a.orgId}, ${uniq('Admin')}, ${a.coordinator.userId}, 'POINT Z (0 0 0)', 'map', ${a.admin.userId})`,
      ),
    ).rejects.toThrow();
    const [row] = await fixtures.query<{ name: string }>(`SELECT name FROM missions WHERE id = $1`, [mission.id]);
    expect(row).toMatchObject({ name: mission.name });
  });
});

describe('getMission and listMissions', () => {
  it('the administrator reads everything and can do nothing (all actions false), the coordinator can', async () => {
    const mission = await createMission(a.coordinator, newMission({ origins: [{ name: 'Base', lat: 42.7, lon: 0.4 }] }));
    const asAdmin = MissionDetail.parse(await (await call(a.admin, 'GET', `/missions/${mission.id}`)).json());
    expect(asAdmin.actions).toEqual({ edit: false, activate: false, close: false, reopen: false, duplicate: false, manageParticipants: false, manageRoutes: false });
    const asCoordinator = MissionDetail.parse(await (await call(a.secondCoordinator, 'GET', `/missions/${mission.id}`)).json());
    expect(asCoordinator.actions.edit).toBe(true);
    expect({ ...asAdmin, actions: null }).toEqual({ ...asCoordinator, actions: null });
  });

  it('filters by status, name and coordinator, pages with the total of the filtered results and answers the schema', async () => {
    const orgId = await fixtures.organization('Org lists');
    const coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
    const other = await fixtures.member(orgId, 'coordinator', 'active', options);
    const alpha = await createMission(coordinator, { name: 'Alpha ridge 100%', target: inPyrenees });
    const beta = await createMission(other, { name: 'Beta ridge', target: inPyrenees });
    const gamma = await createMission(coordinator, { name: 'Gamma valley', target: inPyrenees });
    await setStatus(beta.id, 'active');
    await setStatus(gamma.id, 'closed');

    const list = async (query: string) => MissionsPage.parse(await (await call(coordinator, 'GET', `/missions${query}`)).json());
    expect((await list('')).items.map((m) => m.name)).toEqual(['Gamma valley', 'Beta ridge', 'Alpha ridge 100%']);
    expect((await list('?status=planning')).items.map((m) => m.id)).toEqual([alpha.id]);
    expect((await list('?status=active')).items.map((m) => m.id)).toEqual([beta.id]);
    expect((await list('?status=closed')).items.map((m) => m.id)).toEqual([gamma.id]);
    expect((await list('?q=RIDGE')).items.map((m) => m.id)).toEqual([beta.id, alpha.id]);
    expect((await list(`?q=${encodeURIComponent('100%')}`)).items.map((m) => m.id)).toEqual([alpha.id]);
    expect((await list(`?q=${encodeURIComponent('%')}`)).total).toBe(1); // a wildcard in the search is taken literally
    expect((await list(`?coordinatorId=${other.userId}`)).items.map((m) => m.id)).toEqual([beta.id]);
    const paged = await list('?pageSize=2&page=2');
    expect(paged).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(paged.items.map((m) => m.id)).toEqual([alpha.id]);
    expect((await list('?status=planning&q=zzz')).items).toEqual([]);
    expect((await list('')).items[0]!.coordinator).toEqual({ id: coordinator.userId, displayName: 'Fictitious coordinator' });
  });

  it('an invalid query answers VALIDATION_FAILED and an unknown status too', async () => {
    await expectError(await call(a.coordinator, 'GET', '/missions?status=archived'), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'GET', '/missions?pageSize=500'), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'GET', '/missions/not-a-uuid'), 'VALIDATION_FAILED');
  });
});

describe('roles: the rescuer has no access to staff operations (rule 2)', () => {
  it('answers 403 FORBIDDEN on the six operations, with a real mission id', async () => {
    const mission = await createMission(a.coordinator);
    const calls: [string, string, unknown?][] = [
      ['GET', '/org/coordinators'],
      ['GET', '/missions'],
      ['POST', '/missions', newMission()],
      ['GET', `/missions/${mission.id}`],
      ['PATCH', `/missions/${mission.id}`, { name: 'Nope' }],
      ['GET', `/missions/${mission.id}/history`],
    ];
    for (const [method, path, body] of calls) await expectError(await call(a.rescuer, method, path, body), 'FORBIDDEN');
  });
});

describe('listCoordinators (RF-201)', () => {
  it('lists the active coordinators of the organization by name: no rescuer, no administrator, no disabled account, none of B', async () => {
    const response = await call(a.coordinator, 'GET', '/org/coordinators');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { id: string; displayName: string }[] };
    expect(body.items.map((i) => i.id).sort()).toEqual([a.coordinator.userId, a.secondCoordinator.userId].sort());
    expect(Object.keys(body)).toEqual(['items']);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(['displayName', 'id']);
    const names = body.items.map((i) => i.displayName);
    expect(names).toEqual([...names].sort());

    const asAdmin = (await (await call(a.admin, 'GET', '/org/coordinators')).json()) as { items: { id: string }[] };
    expect(asAdmin.items.map((i) => i.id).sort()).toEqual(body.items.map((i) => i.id).sort());
    const ofB = (await (await call(b.coordinator, 'GET', '/org/coordinators')).json()) as { items: { id: string }[] };
    expect(ofB.items.map((i) => i.id)).toEqual([b.coordinator.userId]);
  });
});
