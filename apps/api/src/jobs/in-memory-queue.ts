import type { Tx } from '../db/database.service.js';
import type { JobPayload, JobQueue, QueuedJob } from './queue.js';

interface Entry {
  queue: string;
  data: JobPayload;
  attempts: number;
}

/**
 * A queue for the tests of the jobs: it keeps the jobs in memory and runs them when the test says so (`drain`), with the same
 * retry rule as the real one. It ignores the transaction it is given, so a test that needs "no job without its row" uses pg-boss.
 */
export class InMemoryQueue implements JobQueue {
  private readonly entries: Entry[] = [];
  private readonly handlers = new Map<string, (job: QueuedJob) => Promise<void>>();
  private nextId = 1;
  readonly retryLimit: number;

  constructor(options: { retryLimit?: number } = {}) {
    this.retryLimit = options.retryLimit ?? 2;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async enqueue(_tx: Tx, queue: string, data: JobPayload): Promise<void> {
    this.entries.push({ queue, data, attempts: 0 });
  }

  async work(queue: string, handler: (job: QueuedJob) => Promise<void>): Promise<void> {
    this.handlers.set(queue, handler);
  }

  /** Forgets the jobs that have not run (a test that wants to deliver one by hand). */
  discardAll(): void {
    this.entries.length = 0;
  }

  get pending(): number {
    return this.entries.length;
  }

  /** Runs every queued job, one at a time, retrying the ones whose handler throws until `retryLimit`. */
  async drain(): Promise<void> {
    while (this.entries.length > 0) {
      const entry = this.entries.shift()!;
      const handler = this.handlers.get(entry.queue);
      if (!handler) throw new Error(`nobody works on the queue ${entry.queue}`);
      try {
        await handler({ id: `memory-${this.nextId++}`, data: entry.data, retryCount: entry.attempts, retryLimit: this.retryLimit });
      } catch {
        entry.attempts += 1;
        if (entry.attempts <= this.retryLimit) this.entries.unshift(entry);
      }
    }
  }
}
