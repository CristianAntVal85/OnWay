import { Global, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { CalculationJobs } from './calculation-jobs.service.js';
import { InMemoryQueue } from './in-memory-queue.js';
import { JobRunner } from './job-runner.js';
import { JobsController } from './jobs.controller.js';
import { JOB_QUEUE, type JobQueue } from './queue.js';

export interface JobsOptions {
  queue?: JobQueue;
}

/** Stops the queue when the application closes (the API only sends; the worker also takes jobs). */
@Injectable()
class QueueLifecycle implements OnModuleDestroy {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}
  async onModuleDestroy(): Promise<void> {
    await this.queue.stop();
  }
}

/**
 * The calculation jobs (H3): the queue, their record, `getJob` and the runner the worker uses. Without options the in-memory queue
 * answers (the tests); `main.ts` and `worker.ts` pass the pg-boss one.
 */
@Global()
@Module({})
export class JobsModule {
  static register(options: JobsOptions = {}): DynamicModule {
    return {
      module: JobsModule,
      controllers: [JobsController],
      providers: [{ provide: JOB_QUEUE, useValue: options.queue ?? new InMemoryQueue() }, CalculationJobs, JobRunner, QueueLifecycle],
      exports: [JOB_QUEUE, CalculationJobs, JobRunner],
    };
  }
}
