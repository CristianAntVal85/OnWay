import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';
import { CALCULATE_QUEUE, JOB_QUEUE, type JobQueue } from './queue.js';

export type JobKind = 'generate' | 'adapt';
export type JobErrorCode = 'NO_ROUTE_POSSIBLE' | 'OUTSIDE_COVERAGE' | 'ROUTING_UNAVAILABLE' | 'INTERNAL';

/** A job as the worker needs it. */
export interface JobRecord {
  id: string;
  kind: JobKind;
  status: 'pending' | 'running' | 'completed' | 'failed';
  params: unknown;
  missionId: string | null;
  requestedBy: string;
}

interface Row {
  id: string;
  kind: JobKind;
  status: JobRecord['status'];
  progress: number;
  error_code: JobErrorCode | null;
  created_at: string;
  finished_at: string | null;
  result: unknown;
}

/**
 * The record of the calculations (`calculation_jobs`, doc 05). The request that asks for one creates the row and puts the job in
 * the queue in the same transaction; the worker moves the row from `pending` to `running` and then to `completed` or `failed`, in
 * transactions of its own so that the progress is visible while it works. Another organization's job is not there (INV-01).
 */
@Injectable()
export class CalculationJobs {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  /** Inside the request transaction: the row and its place in the queue commit together or not at all. */
  async create(principal: Principal, kind: JobKind, params: unknown, missionId: string | null): Promise<string> {
    const { orgId, userId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`
      INSERT INTO calculation_jobs (organization_id, requested_by, mission_id, kind, params)
      VALUES (${orgId}::uuid, ${userId}::uuid, ${missionId}::uuid, ${kind}::job_kind, ${JSON.stringify(params)}::jsonb)
      RETURNING id`);
    const jobId = (rows as unknown as { id: string }[])[0]!.id;
    await this.queue.enqueue(this.tx, CALCULATE_QUEUE, { jobId, orgId, userId });
    return jobId;
  }

  async get(principal: Principal, jobId: string): Promise<OperationOutput<'getJob'>> {
    const { orgId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`
      SELECT id, kind::text AS kind, status::text AS status, progress, error_code, ${sql.raw(isoUtc('created_at'))} AS created_at,
             CASE WHEN finished_at IS NULL THEN NULL ELSE ${sql.raw(isoUtc('finished_at'))} END AS finished_at, result
        FROM calculation_jobs WHERE id = ${jobId}::uuid AND organization_id = ${orgId}::uuid`);
    const row = (rows as unknown as Row[])[0];
    if (!row) throw new DomainError('NOT_FOUND');
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      progress: row.progress,
      errorCode: row.error_code,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
      result: row.result ?? null,
    } as OperationOutput<'getJob'>;
  }

  // ---- The worker's side: every method is called inside its own `withContext`. ----

  /** Locks the job and moves a `pending` one to `running`. `undefined` when it does not exist for this organization. */
  async begin(jobId: string): Promise<JobRecord | undefined> {
    const { rows } = await this.tx.execute(sql`
      SELECT id, kind::text AS kind, status::text AS status, params, mission_id, requested_by FROM calculation_jobs WHERE id = ${jobId}::uuid FOR UPDATE`);
    const row = (rows as unknown as { id: string; kind: JobKind; status: JobRecord['status']; params: unknown; mission_id: string | null; requested_by: string }[])[0];
    if (!row) return undefined;
    if (row.status === 'pending') {
      await this.tx.execute(sql`UPDATE calculation_jobs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = ${jobId}::uuid`);
      row.status = 'running';
    }
    return { id: row.id, kind: row.kind, status: row.status, params: row.params, missionId: row.mission_id, requestedBy: row.requested_by };
  }

  async setProgress(jobId: string, progress: number): Promise<void> {
    await this.tx.execute(sql`UPDATE calculation_jobs SET progress = GREATEST(progress, ${Math.max(0, Math.min(99, Math.round(progress)))}) WHERE id = ${jobId}::uuid AND status = 'running'`);
  }

  async complete(jobId: string, result: unknown): Promise<void> {
    await this.tx.execute(sql`
      UPDATE calculation_jobs SET status = 'completed', progress = 100, result = ${JSON.stringify(result)}::jsonb, finished_at = now() WHERE id = ${jobId}::uuid AND status = 'running'`);
  }

  async fail(jobId: string, code: JobErrorCode, message?: string): Promise<void> {
    await this.tx.execute(sql`
      UPDATE calculation_jobs SET status = 'failed', error_code = ${code}, error_message = ${message?.slice(0, 500) ?? null}, finished_at = now()
       WHERE id = ${jobId}::uuid AND status IN ('pending', 'running')`);
  }
}
