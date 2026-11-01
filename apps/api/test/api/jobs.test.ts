import { randomUUID } from 'node:crypto';
import { ERROR_HTTP, ErrorResponse, Job, type ErrorCode } from '@onway/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { DomainError } from '../../src/common/domain-error.js';
import { InMemoryQueue } from '../../src/jobs/in-memory-queue.js';
import { JobRunner } from '../../src/jobs/job-runner.js';
import { CALCULATE_QUEUE } from '../../src/jobs/queue.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';
import { jobsOf } from '../support/jobs.js';

// The job record, its runner and getJob (H3-T6) on real PostGIS with the in-memory queue. INV-01 (404 across organizations).
// The real queue (pg-boss), the rollback of a job and the death of a worker are in jobs-queue.test.ts.
let app: TestApp;
let fixtures: Fixtures;
let runner: JobRunner;
let queue: InMemoryQueue;
let ask: ReturnType<typeof jobsOf>;

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
  queue = new InMemoryQueue({ retryLimit: 2 });
  app = await startApp({ database: appConnection, jobs: { queue } });
  runner = app.app.get(JobRunner);
  await queue.work(CALCULATE_QUEUE, (job) => runner.process(job));
  ask = jobsOf(app);
  a = await build('Org A');
  b = await build('Org B');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

beforeEach(() => {
  runner.register('generate', async () => ({ routeIds: [] }));
});

async function getJob(member: Member, jobId: string): Promise<Response> {
  if (!sessions.has(member.userId)) sessions.set(member.userId, await mustLogin(app, member.email, TEST_PASSWORD));
  return fetch(`${app.baseUrl}/jobs/${jobId}`, { headers: withSession(sessions.get(member.userId)!, false) });
}
async function expectError(response: Response, code: ErrorCode) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
}
const rowOf = async (jobId: string) =>
  (
    await fixtures.query<{ status: string; progress: number; error_code: string | null; error_message: string | null; started_at: string | null; finished_at: string | null; result: unknown }>(
      `SELECT status::text, progress, error_code, error_message, started_at, finished_at, result FROM calculation_jobs WHERE id = $1`,
      [jobId],
    )
  )[0]!;

describe('the life of a job', () => {
  it('goes from pending to running to completed, with the progress visible while it runs', async () => {
    const seen: { status: string; progress: number }[] = [];
    runner.register('generate', async ({ setProgress, job }) => {
      await setProgress(30);
      seen.push(await rowOf(job.id));
      await setProgress(70);
      seen.push(await rowOf(job.id));
      return { routeIds: ['r1', 'r2'] };
    });
    const jobId = await ask.request(a.coordinator, a.orgId);
    expect(await rowOf(jobId)).toMatchObject({ status: 'pending', progress: 0, started_at: null, finished_at: null });
    await queue.drain();
    expect(seen).toMatchObject([
      { status: 'running', progress: 30 },
      { status: 'running', progress: 70 },
    ]);
    const done = await rowOf(jobId);
    expect(done).toMatchObject({ status: 'completed', progress: 100, error_code: null, result: { routeIds: ['r1', 'r2'] } });
    expect(done.started_at).not.toBeNull();
    expect(done.finished_at).not.toBeNull();
  });

  it('never moves the progress back', async () => {
    runner.register('generate', async ({ setProgress, job }) => {
      await setProgress(60);
      await setProgress(20);
      expect((await rowOf(job.id)).progress).toBe(60);
      return { routeIds: [] };
    });
    await ask.request(a.coordinator, a.orgId);
    await queue.drain();
  });

  it('fails at once, without retries, when there is no way or the point is outside the coverage', async () => {
    for (const code of ['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE'] as const) {
      let calls = 0;
      runner.register('generate', async () => {
        calls += 1;
        throw new DomainError(code);
      });
      const jobId = await ask.request(a.coordinator, a.orgId);
      await queue.drain();
      expect(calls).toBe(1);
      expect(await rowOf(jobId)).toMatchObject({ status: 'failed', error_code: code });
    }
  });

  it('tries again when the engine is down, and completes if it comes back', async () => {
    let calls = 0;
    runner.register('generate', async () => {
      calls += 1;
      if (calls < 3) throw new DomainError('ROUTING_UNAVAILABLE');
      return { routeIds: ['r1'] };
    });
    const jobId = await ask.request(a.coordinator, a.orgId);
    await queue.drain();
    expect(calls).toBe(3);
    expect(await rowOf(jobId)).toMatchObject({ status: 'completed', result: { routeIds: ['r1'] } });
  });

  it('fails with the code of the last error when the retries run out: ROUTING_UNAVAILABLE, or INTERNAL for anything unexpected', async () => {
    let calls = 0;
    runner.register('generate', async () => {
      calls += 1;
      throw new DomainError('ROUTING_UNAVAILABLE');
    });
    const down = await ask.request(a.coordinator, a.orgId);
    await queue.drain();
    expect(calls).toBe(3); // the first attempt and two retries
    expect(await rowOf(down)).toMatchObject({ status: 'failed', error_code: 'ROUTING_UNAVAILABLE' });

    runner.register('generate', async () => {
      throw new Error('something nobody expected');
    });
    const broken = await ask.request(a.coordinator, a.orgId);
    await queue.drain();
    expect(await rowOf(broken)).toMatchObject({ status: 'failed', error_code: 'INTERNAL', error_message: 'something nobody expected' });
  });

  it('leaves alone a job that is delivered again after it finished', async () => {
    let calls = 0;
    runner.register('generate', async () => {
      calls += 1;
      return { routeIds: [] };
    });
    const jobId = await ask.request(a.coordinator, a.orgId);
    await queue.drain();
    const finished = await rowOf(jobId);
    await runner.process({ id: 'again', data: { jobId, orgId: a.orgId, userId: a.coordinator.userId }, retryCount: 0, retryLimit: 2 });
    expect(calls).toBe(1);
    expect(await rowOf(jobId)).toEqual(finished);
  });

  it('fails a job of a kind nobody handles, instead of leaving it running', async () => {
    const jobId = await ask.request(a.coordinator, a.orgId, 'adapt');
    await queue.drain();
    expect(await rowOf(jobId)).toMatchObject({ status: 'failed', error_code: 'INTERNAL' });
  });

  it('does not run a job for an organization it does not belong to', async () => {
    const jobId = await ask.request(a.coordinator, a.orgId);
    queue.discardAll();
    await expect(runner.process({ id: 'x', data: { jobId, orgId: b.orgId, userId: b.coordinator.userId }, retryCount: 0, retryLimit: 2 })).rejects.toThrow(/not in the database/);
    expect((await rowOf(jobId)).status).toBe('pending');
  });
});

describe('getJob', () => {
  it('answers the state of the job as the contract says, to who asked and to the other coordinators and the administrator of the organization', async () => {
    const routeId = randomUUID();
    runner.register('generate', async () => ({ routeIds: [routeId] }));
    const jobId = await ask.request(a.coordinator, a.orgId);
    const pending = Job.parse(await (await getJob(a.coordinator, jobId)).json());
    expect(pending).toMatchObject({ id: jobId, kind: 'generate', status: 'pending', progress: 0, errorCode: null, finishedAt: null, result: null });
    await queue.drain();
    for (const member of [a.coordinator, a.secondCoordinator, a.admin]) {
      const response = await getJob(member, jobId);
      expect(response.status).toBe(200);
      expect(Job.parse(await response.json())).toMatchObject({ status: 'completed', progress: 100, result: { routeIds: [routeId] } });
    }
  });

  it('shows the error code of a failed job', async () => {
    runner.register('generate', async () => {
      throw new DomainError('NO_ROUTE_POSSIBLE');
    });
    const jobId = await ask.request(a.coordinator, a.orgId);
    await queue.drain();
    expect(Job.parse(await (await getJob(a.coordinator, jobId)).json())).toMatchObject({ status: 'failed', errorCode: 'NO_ROUTE_POSSIBLE', result: null });
  });

  it('is 404 for a job of another organization (INV-01) and for one that does not exist, 403 for the rescuer', async () => {
    const jobId = await ask.request(a.coordinator, a.orgId);
    await expectError(await getJob(b.coordinator, jobId), 'NOT_FOUND');
    await expectError(await getJob(a.coordinator, '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
    await expectError(await getJob(a.rescuer, jobId), 'FORBIDDEN');
    await expectError(await getJob(a.coordinator, 'not-an-id'), 'VALIDATION_FAILED');
  });
});
