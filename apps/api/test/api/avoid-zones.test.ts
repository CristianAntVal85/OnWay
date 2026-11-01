import { randomBytes } from 'node:crypto';
import { AvoidZone, ERROR_HTTP, ErrorResponse, MissionDetail, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// listAvoidZones, createAvoidZone and deleteAvoidZone (H3-T4) on real PostGIS.
// RF-507, Q-05 (organization-wide zones with an optional mission), INV-01 (404 across organizations), INV-16 (audit), rule 5 (closed mission).
let app: TestApp;
let fixtures: Fixtures;

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
  app = await startApp({ database: appConnection });
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
/** A square of `size` degrees from (0.65, 42.6), closed. */
const square = (size = 0.002, west = 0.65, south = 42.6) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
});
/** A bow tie: its edges cross, so it is not a valid polygon. */
const bowTie = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [0.65, 42.6],
      [0.652, 42.602],
      [0.652, 42.6],
      [0.65, 42.602],
      [0.65, 42.6],
    ],
  ],
};

const create = async (member: Member, body: Record<string, unknown>) => {
  const response = await call(member, 'POST', '/avoid-zones', { geometry: square(), ...body });
  return response;
};
const created = async (member: Member, body: Record<string, unknown> = {}) => {
  const response = await create(member, body);
  expect(response.status).toBe(201);
  return AvoidZone.parse(await response.json());
};
async function missionOf(member: Member): Promise<string> {
  const response = await call(member, 'POST', '/missions', { name: uniq('Mission'), target: { source: 'map', lat: 42.6, lon: 0.65 } });
  expect(response.status).toBe(201);
  return MissionDetail.parse(await response.json()).id;
}
const auditOf = (zoneId: string) =>
  fixtures.query<{ action: string; actor_user_id: string; organization_id: string; entity_type: string; detail: Record<string, unknown> }>(
    `SELECT action, actor_user_id, organization_id, entity_type, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`,
    [zoneId],
  );
const zonesOf = async (orgId: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM avoid_zones WHERE organization_id = $1`, [orgId]))[0]!.n);
const listOf = async (member: Member, query = '') => {
  const response = await call(member, 'GET', `/avoid-zones${query}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { items: unknown[] };
  return body.items.map((item) => AvoidZone.parse(item));
};

describe('createAvoidZone', () => {
  it('draws a zone of the organization and answers it as the contract says, with one audit row (INV-16)', async () => {
    const zone = await created(a.coordinator, { reason: 'Derrumbe en el sendero' });
    expect(zone).toMatchObject({ missionId: null, reason: 'Derrumbe en el sendero' });
    expect(zone.geometry.coordinates[0]).toHaveLength(5);
    const audit = await auditOf(zone.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'avoid_zone_created', actor_user_id: a.coordinator.userId, organization_id: a.orgId, entity_type: 'avoid_zone' });
    // The audit detail holds the size and the mission, never the free text of the reason.
    expect(JSON.stringify(audit[0]!.detail)).not.toContain('Derrumbe');
  });

  it('draws a zone of a mission', async () => {
    const missionId = await missionOf(a.coordinator);
    const zone = await created(a.coordinator, { missionId });
    expect(zone.missionId).toBe(missionId);
  });

  it('refuses a polygon that crosses itself and one with too many vertices, and leaves nothing behind', async () => {
    const before = [await zonesOf(a.orgId), (await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM audit_log`))[0]!.n];
    const crossing = await expectError(await create(a.coordinator, { geometry: bowTie }), 'VALIDATION_FAILED');
    expect(JSON.stringify(crossing.details)).toContain('invalid_polygon');
    const ring = Array.from({ length: 220 }, (_, i) => [0.65 + 0.001 * Math.cos((i / 220) * 2 * Math.PI), 42.6 + 0.001 * Math.sin((i / 220) * 2 * Math.PI)] as [number, number]);
    const tooMany = await expectError(await create(a.coordinator, { geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] } }), 'VALIDATION_FAILED');
    expect(JSON.stringify(tooMany.details)).toContain('too_many_vertices');
    await expectError(
      await create(a.coordinator, {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        reason: 'x'.repeat(301),
      }),
      'VALIDATION_FAILED',
    );
    expect([await zonesOf(a.orgId), (await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM audit_log`))[0]!.n]).toEqual(before);
  });

  it('does not take a mission of another organization (INV-01), nor one that is closed (rule 5)', async () => {
    const foreign = await missionOf(b.coordinator);
    await expectError(await create(a.coordinator, { missionId: foreign }), 'NOT_FOUND');
    const missionId = await missionOf(a.coordinator);
    expect((await call(a.coordinator, 'POST', `/missions/${missionId}/activate`, { confirmWithoutValidatedRoute: true })).status).toBeLessThan(300);
    expect((await call(a.coordinator, 'POST', `/missions/${missionId}/close`, { attendance: [] })).status).toBe(200);
    await expectError(await create(a.coordinator, { missionId }), 'MISSION_CLOSED');
  });

  it('is for coordinators only: the administrator reads and the rescuer sees nothing', async () => {
    await expectError(await create(a.admin, {}), 'FORBIDDEN');
    await expectError(await create(a.rescuer, {}), 'FORBIDDEN');
  });
});

describe('listAvoidZones', () => {
  it('lists the zones of the organization, and with a mission those and the mission’s own', async () => {
    const missionId = await missionOf(a.coordinator);
    const otherMission = await missionOf(a.coordinator);
    const org = await created(a.coordinator);
    const own = await created(a.coordinator, { missionId });
    const foreignToThis = await created(a.coordinator, { missionId: otherMission });
    const withoutMission = (await listOf(a.coordinator)).map((zone) => zone.id);
    expect(withoutMission).toContain(org.id);
    expect(withoutMission).not.toContain(own.id);
    const withMission = (await listOf(a.coordinator, `?missionId=${missionId}`)).map((zone) => zone.id);
    expect(withMission).toContain(org.id);
    expect(withMission).toContain(own.id);
    expect(withMission).not.toContain(foreignToThis.id);
  });

  it('shows the administrator the zones but not the zones, mission or ids of another organization (INV-01)', async () => {
    const mine = await created(a.coordinator);
    const theirs = await created(b.coordinator);
    const seenByAdmin = (await listOf(a.admin)).map((zone) => zone.id);
    expect(seenByAdmin).toContain(mine.id);
    expect(seenByAdmin).not.toContain(theirs.id);
    expect((await listOf(b.coordinator)).map((zone) => zone.id)).not.toContain(mine.id);
    await expectError(await call(a.coordinator, 'GET', `/avoid-zones?missionId=${await missionOf(b.coordinator)}`), 'NOT_FOUND');
  });

  it('is not for the rescuer', async () => {
    await expectError(await call(a.rescuer, 'GET', '/avoid-zones'), 'FORBIDDEN');
  });
});

describe('deleteAvoidZone', () => {
  it('deletes the zone and audits it (INV-16)', async () => {
    const zone = await created(a.coordinator);
    expect((await call(a.coordinator, 'DELETE', `/avoid-zones/${zone.id}`)).status).toBe(204);
    expect((await listOf(a.coordinator)).map((z) => z.id)).not.toContain(zone.id);
    expect((await auditOf(zone.id)).map((row) => row.action)).toEqual(['avoid_zone_created', 'avoid_zone_deleted']);
    await expectError(await call(a.coordinator, 'DELETE', `/avoid-zones/${zone.id}`), 'NOT_FOUND');
  });

  it('answers 404 for a zone of another organization and leaves it in place (INV-01)', async () => {
    const theirs = await created(b.coordinator);
    await expectError(await call(a.coordinator, 'DELETE', `/avoid-zones/${theirs.id}`), 'NOT_FOUND');
    expect((await listOf(b.coordinator)).map((z) => z.id)).toContain(theirs.id);
  });

  it('does not delete the zone of a closed mission (rule 5)', async () => {
    const missionId = await missionOf(a.coordinator);
    const zone = await created(a.coordinator, { missionId });
    expect((await call(a.coordinator, 'POST', `/missions/${missionId}/activate`, { confirmWithoutValidatedRoute: true })).status).toBeLessThan(300);
    expect((await call(a.coordinator, 'POST', `/missions/${missionId}/close`, { attendance: [] })).status).toBe(200);
    await expectError(await call(a.coordinator, 'DELETE', `/avoid-zones/${zone.id}`), 'MISSION_CLOSED');
    expect((await listOf(a.coordinator, `?missionId=${missionId}`)).map((z) => z.id)).toContain(zone.id);
  });

  it('is for coordinators only', async () => {
    const zone = await created(a.coordinator);
    await expectError(await call(a.admin, 'DELETE', `/avoid-zones/${zone.id}`), 'FORBIDDEN');
    await expectError(await call(a.rescuer, 'DELETE', `/avoid-zones/${zone.id}`), 'FORBIDDEN');
  });
});
