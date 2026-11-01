import { randomBytes } from 'node:crypto';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, MissionDetail, MissionPoint, MissionRouteGeometry, MissionRoutesStaff, RouteDetail, RouteVersionDetail, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { FixedClock } from '../support/clock.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// listMissionRoutes and getMissionRouteGeometry (H4-T1) on real PostGIS: the table of a mission for the staff (the pinned version, not the
// latest; the notice of a newer validated version, RF-518; the stale validation, RF-519), the line of the pinned version, and INV-01.
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
/** A diagonal line of `count` points starting at (lon, lat), inside the Pyrenees where every elevation source answers. */
const line = (lon: number, lat: number, count = 6, step = 0.0012) => ({
  type: 'LineString' as const,
  coordinates: Array.from({ length: count }, (_, i) => [lon + i * step, lat + i * step * 0.75] as [number, number]),
});

async function newMission(member: Member): Promise<{ id: string; originId: string }> {
  const response = await call(member, 'POST', '/missions', { name: uniq('Mission'), target: { source: 'map', lat: 42.61, lon: 0.67 } });
  expect(response.status).toBe(201);
  const id = MissionDetail.parse(await response.json()).id;
  const point = await call(member, 'POST', `/missions/${id}/points`, { kind: 'origin', name: 'Origen de prueba', lat: 42.6, lon: 0.65 });
  expect(point.status).toBe(201);
  return { id, originId: MissionPoint.parse(await point.json()).id };
}
/**
 * A drawn route with its version 1 (a Draft) pinned in the mission. `createRoute` does not take `addToMission` until H4-T2, so the row is
 * written the way the writes of T2 will: with the owner's connection, which is only the setup of the test.
 */
async function addDrawn(member: Member, missionId: string, extra: { originPointId?: string; teamId?: string } = {}, geometry = line(0.65, 42.6)) {
  const response = await call(member, 'POST', '/routes', { source: 'drawn', name: uniq('Route'), geometry });
  expect(response.status).toBe(201);
  const created = CreatedRoute.parse(await response.json());
  const added = await fixtures.query<{ id: string }>(
    `INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, origin_point_id, team_id, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [member.orgId, missionId, created.routeId, created.versionId, extra.originPointId ?? null, extra.teamId ?? null, member.userId],
  );
  // Rows added one after the other get the order they were added in (`added_at` is the transaction's time).
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { ...created, missionRouteId: added[0]!.id };
}
const validate = async (member: Member, routeId: string, versionId: string) =>
  expect((await call(member, 'POST', `/routes/${routeId}/versions/${versionId}/validate`, { acknowledged: true })).status).toBe(200);
async function newVersion(member: Member, routeId: string, baseVersionId: string, geometry = line(0.66, 42.61)) {
  const response = await call(member, 'POST', `/routes/${routeId}/versions`, { baseVersionId, geometry });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
async function table(member: Member, missionId: string) {
  const response = await call(member, 'GET', `/missions/${missionId}/routes`);
  expect(response.status).toBe(200);
  return MissionRoutesStaff.parse(await response.json()).items;
}

describe('listMissionRoutes: the table of a mission (RF-502, RF-513)', () => {
  it('shows the pinned version with its metrics, composition and preview, with the origin, the team and no notice', async () => {
    const mission = await newMission(a.coordinator);
    const team = await fixtures.team(a.orgId, 'Seguimiento');
    const added = await addDrawn(a.coordinator, mission.id, { originPointId: mission.originId, teamId: team });
    const [row] = await table(a.coordinator, mission.id);
    expect(row).toMatchObject({
      routeId: added.routeId,
      status: 'added',
      note: null,
      validationIsStale: false,
      newerValidatedVersion: null,
      origin: { id: mission.originId, name: 'Origen de prueba' },
      team: { id: team, locality: 'Locality' },
      pinned: { versionId: added.versionId, number: 1, status: 'draft', validatedAt: null },
    });
    expect(row!.pinned.metrics.distanceM).toBeGreaterThan(0);
    expect(row!.pinned.roadMix.length).toBeGreaterThan(0);
    expect(row!.previewGeometry.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it('is empty for a mission without routes, and lists them in the order they were added', async () => {
    const mission = await newMission(a.coordinator);
    expect(await table(a.coordinator, mission.id)).toEqual([]);
    const first = await addDrawn(a.coordinator, mission.id);
    const second = await addDrawn(a.coordinator, mission.id, {}, line(0.7, 42.62));
    expect((await table(a.coordinator, mission.id)).map((r) => r.routeId)).toEqual([first.routeId, second.routeId]);
  });

  it('RN-13 and RF-518: a newer validated version never moves the pinned one; the row only says there is one', async () => {
    const mission = await newMission(a.coordinator);
    const added = await addDrawn(a.coordinator, mission.id);
    await validate(a.coordinator, added.routeId, added.versionId);
    const v2 = await newVersion(a.coordinator, added.routeId, added.versionId);
    // A Draft version 2 is not a notice: only validated versions are.
    expect((await table(a.coordinator, mission.id))[0]).toMatchObject({ pinned: { number: 1, status: 'validated' }, newerValidatedVersion: null });
    await validate(a.coordinator, added.routeId, v2.versionId);
    const v3 = await newVersion(a.coordinator, added.routeId, v2.versionId);
    await validate(a.coordinator, added.routeId, v3.versionId);
    const [row] = await table(a.coordinator, mission.id);
    expect(row).toMatchObject({ pinned: { versionId: added.versionId, number: 1 }, newerValidatedVersion: { versionId: v3.versionId, number: 3 } });
  });

  it('a pinned Draft is listed as a Draft, and a newer validated version is still noticed', async () => {
    const mission = await newMission(a.coordinator);
    const added = await addDrawn(a.coordinator, mission.id);
    const v2 = await newVersion(a.coordinator, added.routeId, added.versionId);
    await validate(a.coordinator, added.routeId, v2.versionId);
    expect((await table(a.coordinator, mission.id))[0]).toMatchObject({ pinned: { number: 1, status: 'draft' }, newerValidatedVersion: { number: 2 }, validationIsStale: false });
  });

  it('RF-519: the validation of the pinned version is stale after the limit of the organization, read with the Clock', async () => {
    const mission = await newMission(a.coordinator);
    const added = await addDrawn(a.coordinator, mission.id);
    await validate(a.coordinator, added.routeId, added.versionId);
    const validatedAt = new Date(RouteDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${added.routeId}`)).json()).versions[0]!.validatedAt!).getTime();
    const staleAt = async (days: number) => {
      clock.set(new Date(validatedAt + days * 86_400_000));
      return (await table(a.coordinator, mission.id))[0]!.validationIsStale;
    };
    try {
      expect(await staleAt(89)).toBe(false);
      expect(await staleAt(91)).toBe(true);
    } finally {
      clock.set(new Date());
    }
  });

  it('the administrator reads the table too; the rescuer is refused', async () => {
    const mission = await newMission(a.coordinator);
    await addDrawn(a.coordinator, mission.id);
    expect(await table(a.admin, mission.id)).toHaveLength(1);
    await expectError(await call(a.rescuer, 'GET', `/missions/${mission.id}/routes`), 'FORBIDDEN');
  });
});

describe('getMissionRouteGeometry: the line, the stretches and the profile of the pinned version', () => {
  it('answers with the PINNED version even when the route has a newer one, with stretches and a profile', async () => {
    const mission = await newMission(a.coordinator);
    const added = await addDrawn(a.coordinator, mission.id);
    const [row] = await table(a.coordinator, mission.id);
    await validate(a.coordinator, added.routeId, added.versionId);
    const v2 = await newVersion(a.coordinator, added.routeId, added.versionId, line(0.9, 42.4, 9));
    await validate(a.coordinator, added.routeId, v2.versionId);

    const response = await call(a.coordinator, 'GET', `/missions/${mission.id}/routes/${row!.id}/geometry`);
    expect(response.status).toBe(200);
    const geometry = MissionRouteGeometry.parse(await response.json());
    expect(geometry).toMatchObject({ missionRouteId: row!.id, versionNumber: 1 });
    // The line is version 1's (the server densifies what it stores), not version 2's.
    const versionLine = async (versionId: string) => RouteVersionDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${added.routeId}/versions/${versionId}`)).json()).geometry.coordinates;
    expect(geometry.geometry.coordinates).toEqual(await versionLine(added.versionId));
    expect(geometry.geometry.coordinates).not.toEqual(await versionLine(v2.versionId));
    expect(geometry.geometry.coordinates[0]![2]).toBeTypeOf('number'); // the altitude the server measured
    expect(geometry.segments.length).toBeGreaterThan(0);
    expect(geometry.elevationProfile.length).toBeGreaterThanOrEqual(2);
  });

  it('a mission route of another mission, or one that does not exist, is a 404', async () => {
    const one = await newMission(a.coordinator);
    const other = await newMission(a.coordinator);
    await addDrawn(a.coordinator, one.id);
    const [row] = await table(a.coordinator, one.id);
    await expectError(await call(a.coordinator, 'GET', `/missions/${other.id}/routes/${row!.id}/geometry`), 'NOT_FOUND');
    await expectError(await call(a.coordinator, 'GET', `/missions/${one.id}/routes/00000000-0000-4000-8000-000000000000/geometry`), 'NOT_FOUND');
  });

  it('the administrator reads it; the rescuer is refused', async () => {
    const mission = await newMission(a.coordinator);
    await addDrawn(a.coordinator, mission.id);
    const [row] = await table(a.coordinator, mission.id);
    expect((await call(a.admin, 'GET', `/missions/${mission.id}/routes/${row!.id}/geometry`)).status).toBe(200);
    await expectError(await call(a.rescuer, 'GET', `/missions/${mission.id}/routes/${row!.id}/geometry`), 'FORBIDDEN');
  });
});

describe('INV-01: nothing of another organization is there', () => {
  it('a mission, or a mission route, of organization A is a 404 for organization B, for the staff of both roles', async () => {
    const mission = await newMission(a.coordinator);
    await addDrawn(a.coordinator, mission.id);
    const [row] = await table(a.coordinator, mission.id);
    for (const member of [b.coordinator, b.admin]) {
      await expectError(await call(member, 'GET', `/missions/${mission.id}/routes`), 'NOT_FOUND');
      await expectError(await call(member, 'GET', `/missions/${mission.id}/routes/${row!.id}/geometry`), 'NOT_FOUND');
    }
    // Organization B's own mission does not reveal A's route either.
    const own = await newMission(b.coordinator);
    await expectError(await call(b.coordinator, 'GET', `/missions/${own.id}/routes/${row!.id}/geometry`), 'NOT_FOUND');
  });
});
