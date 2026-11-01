import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { JobRunner } from '../../src/jobs/job-runner.js';
import { PgBossQueue } from '../../src/jobs/pg-boss-queue.js';
import { CALCULATE_QUEUE } from '../../src/jobs/queue.js';
import { startApp, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';
import { jobsOf } from '../support/jobs.js';

// The real queue (pg-boss) on real PostGIS: the job goes in with its row or not at all, the schema is installed by the migrator and
// the application role is enough to run it, and a job survives the death of the worker that was carrying it out (H3-T6, D-H3-07).
let fixtures: Fixtures;
let orgId: string;
let coordinator: Member;
const apps: TestApp[] = [];

beforeAll(async () => {
  const { owner } = inject('database');
  fixtures = new Fixtures(owner);
  orgId = await fixtures.organization('Queue');
  coordinator = await fixtures.member(orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
});

// A worker left running would take the jobs of the next test: every test starts with none.
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => {});
});

afterAll(async () => {
  await fixtures?.close();
});

/** A process like the worker: an application with its own pg-boss, taking jobs and running the handler it is given. */
async function startWorker(handler: Parameters<JobRunner['register']>[1]) {
  const { app: connection } = inject('database');
  // Short supervision and expiry: a job whose worker died comes back in seconds, not in ten minutes.
  const queue = new PgBossQueue({ connection, superviseIntervalSeconds: 1, pollingIntervalSeconds: 1, sendOptions: { expireInSeconds: 2, retryDelay: 1, retryLimit: 2 } });
  const app = await startApp({ database: connection, jobs: { queue } });
  apps.push(app);
  const runner = app.app.get(JobRunner);
  runner.register('generate', handler);
  await queue.start();
  await queue.work(CALCULATE_QUEUE, (job) => runner.process(job));
  return { app, queue };
}

const statusOf = async (jobId: string) =>
  (await fixtures.query<{ status: string; progress: number; result: unknown }>(`SELECT status::text, progress, result FROM calculation_jobs WHERE id = $1`, [jobId]))[0]!;
const queuedJobs = async () => Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM pgboss.job WHERE name = $1`, [CALCULATE_QUEUE]))[0]!.n);
const waitFor = async (condition: () => Promise<boolean>, what: string, seconds = 40) => {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe('the job queue (pg-boss)', () => {
  it('was installed by the migrator, and onway_app can use it without any right to change it', async () => {
    const queues = await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM pgboss.queue WHERE name = $1`, [CALCULATE_QUEUE]);
    expect(Number(queues[0]!.n)).toBe(1);
    const privileges = (
      await fixtures.query<{ can_create: boolean; owns: string }>(
        `SELECT has_schema_privilege('onway_app', 'pgboss', 'CREATE') AS can_create,
              (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname = 'pgboss' AND r.rolname = 'onway_app') AS owns`,
      )
    )[0];
    expect(privileges).toEqual({ can_create: false, owns: '0' });
  });

  it('takes a job from the API and completes it, once', async () => {
    let calls = 0;
    const worker = await startWorker(async () => {
      calls += 1;
      return { routeIds: [] };
    });
    const jobId = await jobsOf(worker.app).request(coordinator, orgId);
    await waitFor(async () => (await statusOf(jobId)).status === 'completed', 'the job to complete');
    expect(calls).toBe(1);
    expect((await statusOf(jobId)).progress).toBe(100);
  });

  it('puts the job in the queue with its row or not at all: a request that fails leaves nothing', async () => {
    const worker = await startWorker(async () => ({ routeIds: [] }));
    const jobsBefore = Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM calculation_jobs`))[0]!.n);
    const queuedBefore = await queuedJobs();
    await expect(jobsOf(worker.app).requestAndRollBack(coordinator, orgId)).rejects.toThrow(/after asking for the job/);
    expect(Number((await fixtures.query<{ n: string }>(`SELECT count(*) AS n FROM calculation_jobs`))[0]!.n)).toBe(jobsBefore);
    expect(await queuedJobs()).toBe(queuedBefore);
  });

  it('survives the death of its worker: another one takes the job and completes it, and the work is not done twice', async () => {
    let started = 0;
    let finished = 0;
    // The first worker takes the job and never finishes it, like a process that was killed in the middle.
    const doomed = await startWorker(async () => {
      started += 1;
      await new Promise<never>(() => {});
      throw new Error('unreachable');
    });
    const jobId = await jobsOf(doomed.app).request(coordinator, orgId);
    await waitFor(async () => started === 1 && (await statusOf(jobId)).status === 'running', 'the first worker to start the job');
    // The process dies: its connections close without finishing anything.
    await doomed.queue.stop();
    await doomed.app.close().catch(() => {});
    expect((await statusOf(jobId)).status).toBe('running');

    // A second worker comes up. After the expiry time the job returns to the queue and this one completes it.
    await startWorker(async () => {
      finished += 1;
      return { routeIds: [] };
    });
    await waitFor(async () => (await statusOf(jobId)).status === 'completed', 'the second worker to complete the job', 60);
    expect(started).toBe(1);
    expect(finished).toBe(1);
    expect((await statusOf(jobId)).progress).toBe(100);
  });
});
