import { randomBytes, randomUUID } from 'node:crypto';
import { AvoidZone, ERROR_HTTP, ErrorResponse, Job, JobAccepted, MissionDetail, MissionPoint, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { DomainError } from '../../src/common/domain-error.js';
import { InMemoryQueue } from '../../src/jobs/in-memory-queue.js';
import { JobRunner } from '../../src/jobs/job-runner.js';
import { CALCULATE_QUEUE } from '../../src/jobs/queue.js';
import { DatabaseService } from '../../src/db/database.service.js';
import { InMemoryRouting } from '../../src/routing/in-memory-routing.js';
import { RouteMeasurement } from '../../src/routes/route-measurement.js';
import { RouteWrites } from '../../src/routes/route-writes.service.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// generateRoutes (H3-T7) on real PostGIS with the in-memory engine and queue: INV-14, the routes it proposes (Draft, version 1, measured by
// the server), INV-01 across organizations, INV-16 (audit), the errors of the job and the retry that must not create anything twice.
let app: TestApp;
let fixtures: Fixtures;
let queue: InMemoryQueue;
let runner: JobRunner;
// The engine claims every vertex is at 999 m: the server must not believe it.
const engine = new InMemoryRouting({ falseElevationM: 999 });

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
  queue = new InMemoryQueue({ retryLimit: 2 });
  app = await startApp({ database: appConnection, routing: { provider: engine }, jobs: { queue } });
  runner = app.app.get(JobRunner);
  await queue.work(CALCULATE_QUEUE, (job) => runner.process(job));
  a = await build('Org A');
  b = await build('Org B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

beforeEach(() => {
  engine.setFailure(undefined);
  engine.setBeforeAnswer(undefined);
  queue.discardAll();
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
const from = { lat: 42.6, lon: 0.65 };
const to = { lat: 42.61, lon: 0.67 };
const generate = (member: Member, body: Record<string, unknown> = {}) => call(member, 'POST', '/routes/generate', { from, to, ...body });
const count = async (table: string) => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);
async function missionOf(member: Member, withOrigin: boolean): Promise<{ id: string; originId: string | null }> {
  const response = await call(member, 'POST', '/missions', { name: uniq('Mission'), target: { source: 'map', lat: 42.61, lon: 0.67 } });
  expect(response.status).toBe(201);
  const id = MissionDetail.parse(await response.json()).id;
  if (!withOrigin) return { id, originId: null };
  const point = await call(member, 'POST', `/missions/${id}/points`, { kind: 'origin', name: 'Origen de prueba', lat: 42.6, lon: 0.65 });
  expect(point.status).toBe(201);
  return { id, originId: MissionPoint.parse(await point.json()).id };
}
async function run(member: Member, body: Record<string, unknown> = {}) {
  const response = await generate(member, body);
  expect(response.status).toBe(202);
  const { jobId } = JobAccepted.parse(await response.json());
  await queue.drain();
  const job = Job.parse(await (await call(member, 'GET', `/jobs/${jobId}`)).json());
  return { jobId, job };
}
const routeIdsOf = (job: ReturnType<typeof Job.parse>) => (job.result as { routeIds: string[] } | null)?.routeIds ?? [];

describe('INV-14: generating from a mission needs a target and an origin', () => {
  it('refuses a mission without an origin: no job, no routes, nothing in the queue, the engine not asked', async () => {
    const mission = await missionOf(a.coordinator, false);
    const before = [await count('calculation_jobs'), await count('routes'), await count('audit_log')];
    const calls = engine.calls.length;
    await expectError(await generate(a.coordinator, { addToMission: { missionId: mission.id } }), 'MISSION_HAS_NO_ORIGIN');
    expect([await count('calculation_jobs'), await count('routes'), await count('audit_log')]).toEqual(before);
    expect(queue.pending).toBe(0);
    expect(engine.calls.length).toBe(calls);
  });

  it('accepts a mission with an origin: 202 and a job that is waiting', async () => {
    const mission = await missionOf(a.coordinator, true);
    const response = await generate(a.coordinator, { addToMission: { missionId: mission.id, originPointId: mission.originId } });
    expect(response.status).toBe(202);
    const { jobId } = JobAccepted.parse(await response.json());
    expect(queue.pending).toBe(1);
    expect((await fixtures.query<{ status: string; mission_id: string }>(`SELECT status::text, mission_id FROM calculation_jobs WHERE id = $1`, [jobId]))[0]).toEqual({
      status: 'pending',
      mission_id: mission.id,
    });
  });

  it('refuses a closed mission', async () => {
    const mission = await missionOf(a.coordinator, true);
    expect((await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true })).status).toBeLessThan(300);
    expect((await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [] })).status).toBe(200);
    await expectError(await generate(a.coordinator, { addToMission: { missionId: mission.id } }), 'MISSION_CLOSED');
  });

  it('works from the library with two points and no mission', async () => {
    const { job } = await run(a.coordinator);
    expect(job).toMatchObject({ status: 'completed', progress: 100, errorCode: null });
    expect(routeIdsOf(job)).toHaveLength(3);
  });
});

describe('the routes it proposes', () => {
  it('saves every alternative as a new route in Draft, version 1, measured by the server, with its composition, its job and its audit row', async () => {
    const { jobId, job } = await run(a.coordinator, { alternatives: 3, namePrefix: 'Subida al refugio' });
    const routeIds = routeIdsOf(job);
    expect(routeIds).toHaveLength(3);
    for (const [index, routeId] of routeIds.entries()) {
      const detail = await (await call(a.coordinator, 'GET', `/routes/${routeId}`)).json();
      expect(detail).toMatchObject({ id: routeId, name: `Subida al refugio ${index + 1}`, status: 'active' });
      const [version] = await fixtures.query<{
        version_number: number;
        status: string;
        provenance: string;
        manually_modified: boolean;
        calculation_job_id: string;
        max_elevation_m: string;
        z999: string;
        created_by: string;
      }>(
        `SELECT version_number, status::text, provenance::text, manually_modified, calculation_job_id, max_elevation_m,
                (SELECT count(*) FROM (SELECT (ST_DumpPoints(geom)).geom AS p) d WHERE ST_Z(p) = 999)::text AS z999, created_by
           FROM route_versions WHERE route_id = $1`,
        [routeId],
      );
      expect(version).toMatchObject({ version_number: 1, status: 'draft', provenance: 'generated', manually_modified: false, calculation_job_id: jobId, created_by: a.coordinator.userId });
      // The altitude of the engine (999 m everywhere) reached neither the line nor the metrics (rule 6, INV-15).
      expect(version!.z999).toBe('0');
      expect(Number(version!.max_elevation_m)).not.toBe(999);
      // Composition: the double reports a road for the first half and a path for the second, each stretch with its own line.
      const segments = await fixtures.query<{ road_type: string; points: number }>(
        `SELECT s.road_type::text, ST_NPoints(s.geom) AS points FROM route_segments s JOIN route_versions v ON v.id = s.version_id WHERE v.route_id = $1 ORDER BY s.position`,
        [routeId],
      );
      expect(segments.map((segment) => segment.road_type)).toEqual(['road', 'path']);
      expect(segments[0]!.points).toBeLessThan(Number(await pointsOf(routeId)));
      const audit = await fixtures.query<{ action: string; detail: { source?: string; jobId?: string } }>(`SELECT action, detail FROM audit_log WHERE entity_id = $1`, [routeId]);
      expect(audit).toEqual([{ action: 'route_created', detail: expect.objectContaining({ source: 'generated', jobId, versionNumber: 1 }) }]);
    }
    const requested = await fixtures.query<{ action: string; actor_user_id: string }>(`SELECT action, actor_user_id FROM audit_log WHERE entity_id = $1`, [jobId]);
    expect(requested).toEqual([{ action: 'generate_requested', actor_user_id: a.coordinator.userId }]);
  });

  it('gives the coordinator alternatives that differ, and gives the engine the points, the intermediate ones and the zones', async () => {
    const zone = AvoidZone.parse(
      await (
        await call(a.coordinator, 'POST', '/avoid-zones', {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0.655, 42.602],
                [0.657, 42.602],
                [0.657, 42.604],
                [0.655, 42.604],
                [0.655, 42.602],
              ],
            ],
          },
        })
      ).json(),
    );
    const via = { lat: 42.605, lon: 0.66 };
    const { job } = await run(a.coordinator, { alternatives: 2, via: [via], avoidZoneIds: [zone.id] });
    expect(routeIdsOf(job)).toHaveLength(2);
    const call0 = engine.calls[engine.calls.length - 1]!;
    expect(call0.points).toEqual([from, via, to]);
    expect(call0.avoid).toEqual([zone.geometry.coordinates[0]]);
  });

  it('adds them to the mission with version 1 pinned, the origin and the team, and records it in the history of the mission', async () => {
    const mission = await missionOf(a.coordinator, true);
    const teamId = await fixtures.team(a.orgId, 'Equipo de prueba');
    const { job } = await run(a.coordinator, { alternatives: 2, namePrefix: 'Desde la misión', addToMission: { missionId: mission.id, originPointId: mission.originId, teamId } });
    const routeIds = routeIdsOf(job);
    const linked = await fixtures.query<{ route_id: string; pinned_version_id: string; origin_point_id: string; team_id: string; status: string; added_by: string }>(
      `SELECT route_id, pinned_version_id, origin_point_id, team_id, status::text, added_by FROM mission_routes WHERE mission_id = $1 ORDER BY added_at, route_id`,
      [mission.id],
    );
    expect(linked.map((row) => row.route_id).sort()).toEqual([...routeIds].sort());
    for (const row of linked) {
      expect(row).toMatchObject({ origin_point_id: mission.originId, team_id: teamId, status: 'added', added_by: a.coordinator.userId });
      const [version] = await fixtures.query<{ version_number: number; route_id: string }>(`SELECT version_number, route_id FROM route_versions WHERE id = $1`, [row.pinned_version_id]);
      expect(version).toMatchObject({ version_number: 1, route_id: row.route_id });
    }
    const history = (await (await call(a.coordinator, 'GET', `/missions/${mission.id}/history`)).json()) as { items: { action: string; summary: string | null }[] };
    expect(
      history.items
        .filter((item) => item.action === 'route_added')
        .map((item) => item.summary)
        .sort(),
    ).toEqual(['Desde la misión 1', 'Desde la misión 2']);
  });

  it('saves the routes in the library and does not add them when the mission was closed while the job waited (D-H3-10)', async () => {
    const mission = await missionOf(a.coordinator, true);
    const response = await generate(a.coordinator, { addToMission: { missionId: mission.id } });
    const { jobId } = JobAccepted.parse(await response.json());
    expect((await call(a.coordinator, 'POST', `/missions/${mission.id}/activate`, { confirmWithoutValidatedRoute: true })).status).toBeLessThan(300);
    expect((await call(a.coordinator, 'POST', `/missions/${mission.id}/close`, { attendance: [] })).status).toBe(200);
    await queue.drain();
    const job = Job.parse(await (await call(a.coordinator, 'GET', `/jobs/${jobId}`)).json());
    expect(job.status).toBe('completed');
    expect(routeIdsOf(job)).toHaveLength(3);
    expect(await fixtures.query(`SELECT 1 FROM mission_routes WHERE mission_id = $1`, [mission.id])).toHaveLength(0);
  });
});

describe('when the job cannot be done', () => {
  it('fails with the code of the engine and saves nothing', async () => {
    for (const code of ['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE'] as const) {
      engine.setFailure(code);
      const before = await count('routes');
      const { job } = await run(a.coordinator);
      expect(job).toMatchObject({ status: 'failed', errorCode: code, result: null });
      expect(await count('routes')).toBe(before);
    }
  });

  it('answers ROUTING_UNAVAILABLE at once, without creating a job, when the engine is down', async () => {
    engine.setFailure('ROUTING_UNAVAILABLE');
    const before = [await count('calculation_jobs'), await count('audit_log')];
    await expectError(await generate(a.coordinator), 'ROUTING_UNAVAILABLE');
    expect([await count('calculation_jobs'), await count('audit_log')]).toEqual(before);
    expect(queue.pending).toBe(0);
  });

  it('tries again when the engine fails in the middle of the job, and then saves the routes once', async () => {
    let failures = 1;
    engine.setBeforeAnswer(async () => {
      if (failures-- > 0) throw new DomainError('ROUTING_UNAVAILABLE');
    });
    const { job } = await run(a.coordinator, { alternatives: 2 });
    expect(job.status).toBe('completed');
    expect(routeIdsOf(job)).toHaveLength(2);
  });
});

describe('a job that runs twice does not create anything twice (D-H3-06)', () => {
  it('returns the routes it already saved', async () => {
    const { jobId, job } = await run(a.coordinator, { alternatives: 2 });
    const routes = await count('routes');
    await runner.process({ id: 'redelivery', data: { jobId, orgId: a.orgId, userId: a.coordinator.userId }, retryCount: 0, retryLimit: 2 });
    expect(await count('routes')).toBe(routes);
    expect(Job.parse(await (await call(a.coordinator, 'GET', `/jobs/${jobId}`)).json()).result).toEqual(job.result);
  });
});

describe('saving the proposals', () => {
  it('createGenerated called again for the same job returns the same routes and writes nothing (the retry after a crash)', async () => {
    const { jobId } = await run(a.coordinator, { alternatives: 1 });
    const database = app.app.get(DatabaseService);
    const writes = app.app.get(RouteWrites);
    const measured = await app.app.get(RouteMeasurement).measure([
      [0.65, 42.6],
      [0.66, 42.605],
      [0.67, 42.61],
    ]);
    const before = [await count('routes'), await count('route_versions'), await count('route_segments'), await count('audit_log')];
    const again = await database.withContext({ orgId: a.orgId, userId: a.coordinator.userId, role: 'coordinator' }, () =>
      writes.createGenerated({ orgId: a.orgId, userId: a.coordinator.userId, jobId, names: ['Otra'], measured: [measured] }),
    );
    expect(again).toHaveLength(1);
    expect(again[0]!.name).not.toBe('Otra');
    expect([await count('routes'), await count('route_versions'), await count('route_segments'), await count('audit_log')]).toEqual(before);
  });
});

describe('who can ask, and across organizations (INV-01)', () => {
  it('is for coordinators: the administrator and the rescuer are refused', async () => {
    await expectError(await generate(a.admin), 'FORBIDDEN');
    await expectError(await generate(a.rescuer), 'FORBIDDEN');
  });

  it('does not take the mission, or the zone, of another organization, and does not ignore an id that is not there', async () => {
    const foreignMission = await missionOf(b.coordinator, true);
    await expectError(await generate(a.coordinator, { addToMission: { missionId: foreignMission.id } }), 'NOT_FOUND');
    const foreignZone = AvoidZone.parse(
      await (
        await call(b.coordinator, 'POST', '/avoid-zones', {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0.6, 42.6],
                [0.61, 42.6],
                [0.61, 42.61],
                [0.6, 42.61],
                [0.6, 42.6],
              ],
            ],
          },
        })
      ).json(),
    );
    await expectError(await generate(a.coordinator, { avoidZoneIds: [foreignZone.id] }), 'NOT_FOUND');
    await expectError(await generate(a.coordinator, { avoidZoneIds: [randomUUID()] }), 'NOT_FOUND');
    const mine = await missionOf(a.coordinator, true);
    await expectError(await generate(a.coordinator, { addToMission: { missionId: mine.id, originPointId: randomUUID() } }), 'NOT_FOUND');
    await expectError(await generate(a.coordinator, { addToMission: { missionId: mine.id, teamId: randomUUID() } }), 'NOT_FOUND');
  });

  it('keeps what a coordinator generated out of the other organization', async () => {
    const { job } = await run(a.coordinator);
    const jobId = job.id;
    await expectError(await call(b.coordinator, 'GET', `/jobs/${jobId}`), 'NOT_FOUND');
    for (const routeId of routeIdsOf(job)) await expectError(await call(b.coordinator, 'GET', `/routes/${routeId}`), 'NOT_FOUND');
  });

  it('refuses a request the contract does not allow', async () => {
    await expectError(await generate(a.coordinator, { alternatives: 5 }), 'VALIDATION_FAILED');
    await expectError(await call(a.coordinator, 'POST', '/routes/generate', { to }), 'VALIDATION_FAILED');
    await expectError(await generate(a.coordinator, { via: Array.from({ length: 11 }, () => ({ lat: 42.605, lon: 0.66 })) }), 'VALIDATION_FAILED');
  });
});

async function pointsOf(routeId: string): Promise<string> {
  return (await fixtures.query<{ n: string }>(`SELECT ST_NPoints(geom)::text AS n FROM route_versions WHERE route_id = $1`, [routeId]))[0]!.n;
}
