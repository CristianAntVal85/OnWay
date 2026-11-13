import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CreatedRoute, ERROR_HTTP, ErrorResponse, FileRef, MissionDetail, RouteDetail, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InMemoryFileStorage } from '../../src/files/file-storage.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// deleteRoute (issue #17, RN-14, INV-04, INV-07, INV-01, rule 2) on real PostGIS: only an ARCHIVED route that is in NO mission goes, with
// all its versions (validated ones included) and segments; its derivatives stay and lose the link; the audit keeps a line.
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
  a = await build('Org A delete');
  b = await build('Org B delete');
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

async function createDrawn(member: Member, overrides: Record<string, unknown> = {}) {
  const response = await call(member, 'POST', '/routes', { source: 'drawn', name: uniq('Route'), geometry: line(), ...overrides });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}
const archive = async (member: Member, routeId: string) => expect((await call(member, 'POST', `/routes/${routeId}/archive`)).status).toBe(200);
const remove = (member: Member, routeId: string) => call(member, 'DELETE', `/routes/${routeId}`);
const validate = async (member: Member, routeId: string, versionId: string) =>
  expect((await call(member, 'POST', `/routes/${routeId}/versions/${versionId}/validate`, { acknowledged: true })).status).toBe(200);

const auditOf = (routeId: string) =>
  fixtures.query<{ action: string; actor_user_id: string; organization_id: string; entity_type: string; detail: Record<string, unknown> }>(
    `SELECT action, actor_user_id, organization_id, entity_type, detail FROM audit_log WHERE entity_id = $1 ORDER BY id`,
    [routeId],
  );
const rowsOf = async (table: string, column: string, id: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE ${column} = $1`, [id]))[0]!.n);
const segmentsOf = async (routeId: string) =>
  Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM route_segments s JOIN route_versions v ON v.id = s.version_id WHERE v.route_id = $1`, [routeId]))[0]!.n);

async function missionWith(member: Member, routeId: string, versionId: string, status: 'planning' | 'active' | 'closed') {
  const name = uniq('Mission');
  const { id } = MissionDetail.parse(await (await call(member, 'POST', '/missions', { name, target: { source: 'map', lat: 42.6, lon: 0.65 } })).json());
  // The route enters while the mission is open (INV-11) and the mission is closed afterwards, as it happens.
  await fixtures.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) VALUES ($1, $2, $3, $4, $5)`, [a.orgId, id, routeId, versionId, member.userId]);
  if (status !== 'planning') await fixtures.query(`UPDATE missions SET status = 'active', activated_at = now() WHERE id = $1`, [id]);
  if (status === 'closed') await fixtures.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [id]);
  return { id, name };
}

describe('deleteRoute: an archived route in no mission goes for good (RN-14, INV-04)', () => {
  it('answers 204 with no body, and the route, its versions and its segments are gone', async () => {
    const created = await createDrawn(a.coordinator);
    await archive(a.coordinator, created.routeId);
    expect(await segmentsOf(created.routeId)).toBeGreaterThan(0);

    const response = await remove(a.coordinator, created.routeId);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(await rowsOf('routes', 'id', created.routeId)).toBe(0);
    expect(await rowsOf('route_versions', 'route_id', created.routeId)).toBe(0);
    expect(await segmentsOf(created.routeId)).toBe(0);
    await expectError(await call(a.coordinator, 'GET', `/routes/${created.routeId}`), 'NOT_FOUND');
    const list = (await (await call(a.coordinator, 'GET', '/routes?status=archived&pageSize=100')).json()) as { items: { id: string }[] };
    expect(list.items.map((item) => item.id)).not.toContain(created.routeId);
  });

  it('INV-04: a route with a VALIDATED version and a newer draft goes too', async () => {
    const created = await createDrawn(a.coordinator);
    await validate(a.coordinator, created.routeId, created.versionId);
    expect((await call(a.coordinator, 'POST', `/routes/${created.routeId}/versions`, { baseVersionId: created.versionId, geometry: line(0.001, 7) })).status).toBe(201);
    await archive(a.coordinator, created.routeId);
    expect(await rowsOf('route_versions', 'route_id', created.routeId)).toBe(2);

    expect((await remove(a.coordinator, created.routeId)).status).toBe(204);
    expect(await rowsOf('route_versions', 'route_id', created.routeId)).toBe(0);
    expect(await rowsOf('routes', 'id', created.routeId)).toBe(0);
  });

  it('leaves one audit line, with the name and the number of versions and no geometry', async () => {
    const created = await createDrawn(a.coordinator);
    await validate(a.coordinator, created.routeId, created.versionId);
    await archive(a.coordinator, created.routeId);
    const name = (await fixtures.query<{ name: string }>(`SELECT name FROM routes WHERE id = $1`, [created.routeId]))[0]!.name;
    await remove(a.coordinator, created.routeId);

    const audit = await auditOf(created.routeId);
    expect(audit.map((row) => row.action)).toEqual(['route_created', 'route_version_validated', 'route_archived', 'route_deleted']);
    expect(audit.at(-1)).toMatchObject({ entity_type: 'route', organization_id: a.orgId, actor_user_id: a.coordinator.userId, detail: { name, versions: 1, derivativesUnlinked: [] } });
  });
});

describe('deleteRoute: what is not deleted (D-I1, D-I6)', () => {
  it('an ACTIVE route is 409 INVALID_STATE_TRANSITION and nothing changes', async () => {
    const created = await createDrawn(a.coordinator);
    await expectError(await remove(a.coordinator, created.routeId), 'INVALID_STATE_TRANSITION');
    expect(await rowsOf('routes', 'id', created.routeId)).toBe(1);
    expect(await rowsOf('route_versions', 'route_id', created.routeId)).toBe(1);
    expect((await auditOf(created.routeId)).map((row) => row.action)).toEqual(['route_created']);
  });

  it('a route in a mission, open or CLOSED, is 409 ROUTE_IN_USE with those missions, and nothing changes', async () => {
    for (const status of ['planning', 'active', 'closed'] as const) {
      const created = await createDrawn(a.coordinator);
      await validate(a.coordinator, created.routeId, created.versionId);
      await archive(a.coordinator, created.routeId);
      // Only the API refuses to add an archived route; the database does not, and that is how this state is reached.
      const mission = await missionWith(a.coordinator, created.routeId, created.versionId, status);

      const error = await expectError(await remove(a.coordinator, created.routeId), 'ROUTE_IN_USE');
      expect(error.details).toEqual({ missions: [{ id: mission.id, name: mission.name }] });
      expect(await rowsOf('routes', 'id', created.routeId)).toBe(1);
      expect(await rowsOf('route_versions', 'route_id', created.routeId)).toBe(1);
      expect((await auditOf(created.routeId)).map((row) => row.action)).not.toContain('route_deleted');
    }
  });

  it('the route can be deleted once it is removed from the mission it was in', async () => {
    const created = await createDrawn(a.coordinator);
    await archive(a.coordinator, created.routeId);
    const mission = await missionWith(a.coordinator, created.routeId, created.versionId, 'planning');
    await expectError(await remove(a.coordinator, created.routeId), 'ROUTE_IN_USE');
    await fixtures.query(`DELETE FROM mission_routes WHERE mission_id = $1`, [mission.id]);
    expect((await remove(a.coordinator, created.routeId)).status).toBe(204);
  });
});

describe('deleteRoute: derivatives and the original file (D-I4, D-I5)', () => {
  it('the derivatives of the deleted route stay alive and lose only the "derived from" link', async () => {
    const original = await createDrawn(a.coordinator);
    const derived = await call(a.coordinator, 'POST', `/routes/${original.routeId}/derive`, { name: uniq('Derived'), fromVersionId: original.versionId });
    expect(derived.status).toBe(201);
    const child = CreatedRoute.parse(await derived.json());
    await archive(a.coordinator, original.routeId);

    expect((await remove(a.coordinator, original.routeId)).status).toBe(204);
    const detail = RouteDetail.parse(await (await call(a.coordinator, 'GET', `/routes/${child.routeId}`)).json());
    expect(detail).toMatchObject({ id: child.routeId, status: 'active', derivedFrom: null });
    expect(detail.versions).toHaveLength(1);
    const audit = (await auditOf(original.routeId)).at(-1)!;
    expect(audit.detail).toMatchObject({ derivativesUnlinked: [child.routeId] });
  });

  it('the imported file is retired with the route when no other version uses it, and not before', async () => {
    const content = await readFile(new URL('../../../../packages/geo/test/fixtures/ficticio-sendero.gpx', import.meta.url), 'utf8');
    const form = new FormData();
    form.set('purpose', 'route_import');
    form.set('file', new Blob([content], { type: 'application/gpx+xml' }), 'track.gpx');
    const uploaded = await fetch(`${app.baseUrl}/files`, { method: 'POST', headers: withSession(await sessionOf(a.coordinator)), body: form });
    const fileId = FileRef.parse(await uploaded.json()).id;
    const key = (await fixtures.query<{ storage_key: string }>(`SELECT storage_key FROM files WHERE id = $1`, [fileId]))[0]!.storage_key;

    const first = await createFromFile(fileId);
    const second = await createFromFile(fileId);
    await archive(a.coordinator, first.routeId);
    await archive(a.coordinator, second.routeId);

    expect((await remove(a.coordinator, first.routeId)).status).toBe(204);
    expect(storage.keys()).toContain(key);
    expect((await fixtures.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM files WHERE id = $1`, [fileId]))[0]!.deleted_at).toBeNull();

    expect((await remove(a.coordinator, second.routeId)).status).toBe(204);
    expect(storage.keys()).not.toContain(key);
    expect((await fixtures.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM files WHERE id = $1`, [fileId]))[0]!.deleted_at).not.toBeNull();
  });
});

async function createFromFile(fileId: string) {
  const response = await call(a.coordinator, 'POST', '/routes', { source: 'import', name: uniq('Imported'), fileId });
  expect(response.status).toBe(201);
  return CreatedRoute.parse(await response.json());
}

describe('deleteRoute: roles and isolation (rule 1, rule 2, INV-01)', () => {
  it('the administrator and the rescuer are 403 and the route stays', async () => {
    const created = await createDrawn(a.coordinator);
    await archive(a.coordinator, created.routeId);
    await expectError(await remove(a.admin, created.routeId), 'FORBIDDEN');
    await expectError(await remove(a.rescuer, created.routeId), 'FORBIDDEN');
    expect(await rowsOf('routes', 'id', created.routeId)).toBe(1);
  });

  it('without a session it is 401', async () => {
    const created = await createDrawn(a.coordinator);
    const response = await fetch(`${app.baseUrl}/routes/${created.routeId}`, { method: 'DELETE' });
    expect(response.status).toBe(401);
  });

  it('INV-01: the coordinator of another organization gets 404 and nothing changes', async () => {
    const created = await createDrawn(a.coordinator);
    await archive(a.coordinator, created.routeId);
    await expectError(await remove(b.coordinator, created.routeId), 'NOT_FOUND');
    expect(await rowsOf('routes', 'id', created.routeId)).toBe(1);
    expect((await auditOf(created.routeId)).map((row) => row.action)).not.toContain('route_deleted');
  });

  it('a route that does not exist is 404, and so is deleting one twice', async () => {
    await expectError(await remove(a.coordinator, '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
    const created = await createDrawn(a.coordinator);
    await archive(a.coordinator, created.routeId);
    expect((await remove(a.coordinator, created.routeId)).status).toBe(204);
    await expectError(await remove(a.coordinator, created.routeId), 'NOT_FOUND');
  });

  it('two deletions at once: one is 204 and the other 404', async () => {
    const created = await createDrawn(a.coordinator);
    await archive(a.coordinator, created.routeId);
    const statuses = (await Promise.all([remove(a.coordinator, created.routeId), remove(a.coordinator, created.routeId)])).map((response) => response.status).sort();
    expect(statuses).toEqual([204, 404]);
  });
});
