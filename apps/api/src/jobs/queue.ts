import type { Tx } from '../db/database.service.js';

/** The one queue of calculations (generate now, adapt in H9). The payload says who asked: the worker needs the organization before it can read anything. */
export const CALCULATE_QUEUE = 'calculate';

export interface JobPayload {
  jobId: string;
  orgId: string;
  userId: string;
}

/** A job taken from the queue. `retryCount` counts the attempts already made (0 on the first). */
export interface QueuedJob {
  id: string;
  data: JobPayload;
  retryCount: number;
  retryLimit: number;
}

/**
 * The queue behind an interface of our own (D-H3-01, P1), so that pg-boss can be replaced without touching the domain and so that
 * the jobs can be tested without it. Delivery is at least once: a handler must be safe to run again (D-H3-06).
 */
export interface JobQueue {
  /** Puts the job in the queue inside the transaction of the caller: it exists only if the row of `calculation_jobs` does. */
  enqueue(tx: Tx, queue: string, data: JobPayload): Promise<void>;
  /** Takes jobs one at a time. A handler that throws gets the job back for another attempt until `retryLimit`. */
  work(queue: string, handler: (job: QueuedJob) => Promise<void>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Injection token, as `ROUTING_PROVIDER` is. */
export const JOB_QUEUE = Symbol('JOB_QUEUE');
