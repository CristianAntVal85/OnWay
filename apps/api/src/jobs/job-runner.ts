import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../common/domain-error.js';
import { DatabaseService } from '../db/database.service.js';
import { CalculationJobs, type JobErrorCode, type JobKind, type JobRecord } from './calculation-jobs.service.js';
import type { QueuedJob } from './queue.js';

/** What a handler of a kind of job receives. Each call of `setProgress` is committed on its own, so the page sees it while the job runs. */
export interface JobContext {
  job: JobRecord;
  orgId: string;
  userId: string;
  setProgress(progress: number): Promise<void>;
}

/** Returns the `result` the job is completed with. A handler must be safe to run again (D-H3-06). */
export type JobHandler = (context: JobContext) => Promise<Record<string, unknown>>;

/** Failures that do not improve by waiting (D-H3-07): the job fails at once with that code. */
const DEFINITIVE: ReadonlySet<string> = new Set(['NO_ROUTE_POSSIBLE', 'OUTSIDE_COVERAGE']);

/**
 * Takes a job from the queue and carries it through its record (`pending` → `running` → `completed` | `failed`). Delivery is at
 * least once: a job that is already finished is left alone, and one whose handler fails for a reason that may pass (the engine is
 * down, something unexpected) is given back to the queue until its retries run out, and only then fails.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private readonly handlers = new Map<JobKind, JobHandler>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CalculationJobs) private readonly jobs: CalculationJobs,
  ) {}

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async process(queued: QueuedJob): Promise<void> {
    const { jobId, orgId, userId } = queued.data;
    // The job acts for the coordinator who asked: the same policies that applied to the request apply to the work.
    const context = { orgId, userId, role: 'coordinator' as const };
    const inContext = <T>(fn: () => Promise<T>) => this.database.withContext(context, fn);

    const job = await inContext(() => this.jobs.begin(jobId));
    if (!job) throw new Error(`job ${jobId} is not in the database`);
    if (job.status === 'completed' || job.status === 'failed') return; // delivered again after it finished

    const handler = this.handlers.get(job.kind);
    if (!handler) {
      await inContext(() => this.jobs.fail(jobId, 'INTERNAL', `no handler for the kind ${job.kind}`));
      return;
    }
    try {
      const result = await handler({ job, orgId, userId, setProgress: (progress) => inContext(() => this.jobs.setProgress(jobId, progress)) });
      await inContext(() => this.jobs.complete(jobId, result));
    } catch (error) {
      const code = errorCodeOf(error);
      if (DEFINITIVE.has(code) || queued.retryCount >= queued.retryLimit) {
        this.logger.warn(`job ${jobId} failed with ${code}${error instanceof Error ? `: ${error.message}` : ''}`);
        await inContext(() => this.jobs.fail(jobId, code, error instanceof Error ? error.message : undefined));
        return;
      }
      this.logger.warn(`job ${jobId} will be tried again (attempt ${queued.retryCount + 1} of ${queued.retryLimit + 1}): ${code}`);
      throw error;
    }
  }
}

function errorCodeOf(error: unknown): JobErrorCode {
  if (error instanceof DomainError && (error.code === 'NO_ROUTE_POSSIBLE' || error.code === 'OUTSIDE_COVERAGE' || error.code === 'ROUTING_UNAVAILABLE')) return error.code;
  return 'INTERNAL';
}
