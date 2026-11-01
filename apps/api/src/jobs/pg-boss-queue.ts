import { sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';
import type { DbConnection } from '../db/config.js';
import type { Tx } from '../db/database.service.js';
import { CALCULATE_QUEUE, type JobPayload, type JobQueue, type QueuedJob } from './queue.js';

/** Schema of pg-boss in the application database, created by the migrator as `onway_owner` (`installJobQueue`). */
export const BOSS_SCHEMA = 'pgboss';

/** How the calculation queue behaves: set once, at install time, and inherited by every job (see `installJobQueue`). */
export const CALCULATE_QUEUE_OPTIONS = {
  // Two more attempts after the first, with growing waits: only the engine being down or an unexpected error come back (D-H3-07).
  retryLimit: 2,
  retryDelay: 10,
  retryBackoff: true,
  // A job that stays `active` longer than this (its worker died) goes back to the queue.
  expireInSeconds: 600,
  // Finished jobs are kept a day: `calculation_jobs` is the record, the queue only moves work.
  deleteAfterSeconds: 86_400,
} as const;

export interface PgBossQueueOptions {
  /** The application role (`onway_app`): it cannot create schemas, so pg-boss is told not to try. */
  connection: DbConnection;
  /** How often expired jobs are found and given back. The default (60 s) is fine in production; tests shorten it. */
  superviseIntervalSeconds?: number;
  /** Seconds between two looks at an empty queue. */
  pollingIntervalSeconds?: number;
  /** Whether this instance also gives back the jobs of dead workers and clears old ones. The worker does; the API only sends, so it does not. */
  supervise?: boolean;
  /** Overrides of the queue's retry and expiry options for the jobs this instance sends: the tests make a dead worker's job expire in seconds, not minutes. */
  sendOptions?: { retryLimit?: number; retryDelay?: number; retryBackoff?: boolean; expireInSeconds?: number };
}

/** pg-boss as the `JobQueue`. The schema is already installed and migrated: this only sends and fetches. */
export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss;

  constructor(private readonly options: PgBossQueueOptions) {
    const { host, port, database, user, password } = options.connection;
    this.boss = new PgBoss({
      host,
      port,
      database,
      user,
      password,
      schema: BOSS_SCHEMA,
      createSchema: false,
      migrate: false,
      max: 4,
      supervise: options.supervise ?? true,
      schedule: false,
      superviseIntervalSeconds: options.superviseIntervalSeconds ?? 60,
    });
    this.boss.on('error', (error: Error) => console.error(`pg-boss: ${error.message}`));
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, close: true, timeout: 10_000 });
  }

  async enqueue(tx: Tx, queue: string, data: JobPayload): Promise<void> {
    const id = await this.boss.send(queue, data, { ...this.options.sendOptions, db: fromDrizzle(tx, sql) });
    if (!id) throw new Error(`pg-boss did not accept the job for the queue ${queue}`);
  }

  async work(queue: string, handler: (job: QueuedJob) => Promise<void>): Promise<void> {
    await this.boss.work<JobPayload>(queue, { batchSize: 1, pollingIntervalSeconds: this.options.pollingIntervalSeconds ?? 1, includeMetadata: true }, async (jobs) => {
      for (const job of jobs) {
        const meta = job as unknown as { retryCount?: number; retryLimit?: number };
        await handler({ id: job.id, data: job.data, retryCount: meta.retryCount ?? 0, retryLimit: meta.retryLimit ?? CALCULATE_QUEUE_OPTIONS.retryLimit });
      }
    });
  }
}

export { CALCULATE_QUEUE };
