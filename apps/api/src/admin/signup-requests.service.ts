import { Inject, Injectable } from '@nestjs/common';
import type { DecideSignupRequest, ListSignupRequestsQuery, OperationOutput, SignupFilter } from '@onway/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { pgErrorOf } from '../db/errors.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';

type Filter = z.infer<typeof SignupFilter>;

interface RequestRow {
  user_id: string;
  email: string;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
}

/** `%text%` for ILIKE with the wildcards of the text itself escaped, so that a search for `a_b` does not match `axb`. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * The requests of the organization that match a filter: the same condition for the list and for «select all the results». The email and the
 * name are the only personal data the inbox shows (Q-34). A person whose data were deleted (RF-812) is not listed.
 */
function matching(orgId: string, filter: Filter): SQL {
  const search = filter.q ? sql`AND (u.email::text ILIKE ${likePattern(filter.q)} OR u.display_name ILIKE ${likePattern(filter.q)})` : sql``;
  return sql`s.organization_id = ${orgId}::uuid AND s.status = ${filter.status}::request_status AND u.anonymized_at IS NULL ${search}`;
}

/**
 * Sign-up requests (RF-106, RN-25, INV-25, INV-29): the inbox of the administrator. Only the administrator reaches it (registry roles,
 * policy `signup_admin`); the filter by organization is the second defence (INV-01). The decision is never written by the application: it
 * calls `admin_decide_signup`, which changes the request, the account, the membership and the profile and writes the audit row
 * (doc 06 §10).
 */
@Injectable()
export class SignupRequests {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, query: z.infer<typeof ListSignupRequestsQuery>): Promise<OperationOutput<'listSignupRequests'>> {
    const { orgId } = viewerOf(principal);
    const where = matching(orgId, query);
    const { rows: counted } = await this.tx.execute(sql`SELECT count(*)::int AS total FROM signup_requests s JOIN users u ON u.id = s.user_id WHERE ${where}`);
    const { rows } = await this.tx.execute(sql`
      SELECT s.user_id, u.email::text AS email, u.display_name, s.status, ${sql.raw(isoUtc('s.requested_at'))} AS requested_at
        FROM signup_requests s JOIN users u ON u.id = s.user_id
       WHERE ${where}
       ORDER BY s.requested_at DESC, s.user_id
       LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    return {
      items: (rows as unknown as RequestRow[]).map((r) => ({ userId: r.user_id, email: r.email, displayName: r.display_name, status: r.status, requestedAt: r.requested_at })),
      page: query.page,
      pageSize: query.pageSize,
      total: (counted as unknown as { total: number }[])[0]!.total,
    };
  }

  /**
   * Approves (with a role) or rejects, one person or many, ALL OR NOTHING (D-A4): the whole selection is decided inside the transaction of
   * the request, so the first failure rolls back every earlier decision, including the audit rows of `admin_decide_signup`.
   */
  async decide(principal: Principal, body: z.infer<typeof DecideSignupRequest>): Promise<OperationOutput<'decideSignupRequests'>> {
    const { orgId } = viewerOf(principal);
    // The function does not check the state in its UPDATEs, so two administrators deciding at once could approve and reject the same person.
    // One decision at a time per organization closes it: the second waits and then sees the request already decided.
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`signup-decisions:${orgId}`}, 0))`);

    const targets = body.selection.mode === 'ids' ? await this.byIds(orgId, body.selection.ids) : await this.byFilter(orgId, body.selection.filter, body.selection.exceptIds);
    // Another organization's or a missing request is a 404 (INV-01) and nothing is decided; one that is not pending any more is a 409.
    if (targets.some((t) => t.status !== 'pending')) throw new DomainError('INVALID_STATE_TRANSITION', 'A request in the selection has already been decided');

    const approve = body.action === 'approve';
    for (const target of targets) {
      try {
        await this.tx.execute(sql`SELECT admin_decide_signup(${target.user_id}::uuid, ${approve}::boolean, ${body.role ?? null}::member_role)`);
      } catch (error) {
        throw translate(error);
      }
    }
    return { affected: targets.length, skipped: [] };
  }

  private async byIds(orgId: string, ids: string[]): Promise<{ user_id: string; status: string }[]> {
    const unique = [...new Set(ids)];
    const { rows } = await this.tx.execute(sql`
      SELECT s.user_id, s.status FROM signup_requests s
       WHERE s.organization_id = ${orgId}::uuid AND s.user_id IN (${sql.join(
         unique.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
       ORDER BY s.requested_at, s.user_id`);
    const found = rows as unknown as { user_id: string; status: string }[];
    if (found.length !== unique.length) throw new DomainError('NOT_FOUND');
    return found;
  }

  private async byFilter(orgId: string, filter: Filter, exceptIds: string[]): Promise<{ user_id: string; status: string }[]> {
    const except = exceptIds.length
      ? sql`AND s.user_id NOT IN (${sql.join(
          exceptIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    const { rows } = await this.tx.execute(sql`
      SELECT s.user_id, s.status FROM signup_requests s JOIN users u ON u.id = s.user_id
       WHERE ${matching(orgId, filter)} ${except}
       ORDER BY s.requested_at, s.user_id`);
    return rows as unknown as { user_id: string; status: string }[];
  }
}

/**
 * What `admin_decide_signup` can still raise after the checks above: the request disappeared from the pending list in between
 * (`no_data_found`) or a membership already exists (`unique_violation`). Both mean the person was decided elsewhere.
 */
function translate(error: unknown): Error {
  const pg = pgErrorOf(error);
  if (pg?.code === 'P0002' || pg?.code === '23505') return new DomainError('INVALID_STATE_TRANSITION', 'A request in the selection has already been decided');
  if (pg?.code === '42501') return new DomainError('FORBIDDEN');
  return error instanceof Error ? error : new Error(String(error));
}
