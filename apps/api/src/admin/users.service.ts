import { Inject, Injectable } from '@nestjs/common';
import type { ListUsersQuery, OperationOutput, UpdateUserRequest } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { pgErrorOf } from '../db/errors.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';
import { listSkillsOf } from '../profile/skill-rows.js';

type Item = OperationOutput<'listUsers'>['items'][number];
type Query = z.infer<typeof ListUsersQuery>;
type UpdateBody = z.infer<typeof UpdateUserRequest>;

interface UserRow {
  user_id: string;
  display_name: string;
  email: string;
  role: Item['role'];
  account_status: Item['accountStatus'];
  last_login_at: string | null;
  profile_status: Item['profileStatus'];
  open_missions: number;
  created_at: string;
}

/** `%text%` for ILIKE with the wildcards of the text itself escaped, so that a search for `a_b` does not match `axb`. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

const toItem = (r: UserRow): Item => ({
  userId: r.user_id,
  displayName: r.display_name,
  email: r.email,
  role: r.role,
  accountStatus: r.account_status,
  lastLoginAt: r.last_login_at,
  profileStatus: r.role === 'rescuer' ? (r.profile_status ?? 'incomplete') : null,
  hasMissionsAsResponsible: r.open_missions,
});

/** The columns of an `AdminUserItem` for a person of the organization (D-U6: only members, never the pending or rejected). */
const SELECT_ITEM = (orgId: string) => sql`
  SELECT u.id AS user_id, u.display_name, u.email::text AS email, m.role, u.account_status,
         ${sql.raw(isoUtc('u.last_login_at'))} AS last_login_at, ${sql.raw(isoUtc('u.created_at'))} AS created_at,
         p.status AS profile_status,
         (SELECT count(*)::int FROM missions ms WHERE ms.organization_id = m.organization_id AND ms.coordinator_id = u.id AND ms.status <> 'closed') AS open_missions
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN rescuer_profiles p ON p.user_id = u.id AND p.organization_id = m.organization_id
   WHERE m.organization_id = ${orgId}::uuid`;

/**
 * Users of the organization (RF-813, doc 06 §7.1). Only the administrator reaches it (registry roles); the filter by organization is the
 * second defence behind the row policies (INV-01): a person of another organization is a 404. Name, email, phone and skills are what the
 * administrator may see here; document and address never (rule 3: `readUserSensitive`, H6).
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, query: Query): Promise<OperationOutput<'listUsers'>> {
    const { orgId } = viewerOf(principal);
    const filters = [
      query.q ? sql`AND (u.email::text ILIKE ${likePattern(query.q)} OR u.display_name ILIKE ${likePattern(query.q)})` : sql``,
      query.role ? sql`AND m.role = ${query.role}::member_role` : sql``,
      query.accountStatus ? sql`AND u.account_status = ${query.accountStatus}::account_status` : sql``,
    ];
    const where = sql.join(filters, sql` `);
    const { rows: counted } = await this.tx.execute(sql`SELECT count(*)::int AS total FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ${orgId}::uuid ${where}`);
    const { rows } = await this.tx.execute(sql`
      ${SELECT_ITEM(orgId)} ${where}
       ORDER BY lower(u.display_name), u.id
       LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    return {
      items: (rows as unknown as UserRow[]).map(toItem),
      page: query.page,
      pageSize: query.pageSize,
      total: (counted as unknown as { total: number }[])[0]!.total,
    };
  }

  async detail(principal: Principal, userId: string): Promise<OperationOutput<'getUser'>> {
    const { orgId } = viewerOf(principal);
    return this.detailIn(orgId, userId);
  }

  /** The detail of a member of the organization; another organization's or a missing person is a 404. Also the answer of `updateUser`. */
  async detailIn(orgId: string, userId: string): Promise<OperationOutput<'getUser'>> {
    const { rows } = await this.tx.execute(sql`${SELECT_ITEM(orgId)} AND u.id = ${userId}::uuid`);
    const row = (rows as unknown as UserRow[])[0];
    if (!row) throw new DomainError('NOT_FOUND');

    const { rows: profiles } = await this.tx.execute(sql`
      SELECT p.id, c.phone FROM rescuer_profiles p LEFT JOIN rescuer_contact c ON c.profile_id = p.id
       WHERE p.user_id = ${userId}::uuid AND p.organization_id = ${orgId}::uuid`);
    const profile = (profiles as unknown as { id: string; phone: string | null }[])[0];
    const { rows: teams } = await this.tx.execute(sql`
      SELECT t.id, t.name, t.locality FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.organization_id = tm.organization_id
       WHERE tm.user_id = ${userId}::uuid AND tm.organization_id = ${orgId}::uuid AND t.status = 'active'
       ORDER BY lower(t.name), t.id`);
    return {
      ...toItem(row),
      phone: profile?.phone ?? null,
      skills: profile ? await listSkillsOf(this.tx, profile.id) : [],
      teams: teams as unknown as { id: string; name: string; locality: string }[],
      createdAt: row.created_at,
    };
  }

  /**
   * Changes the role and/or the state of an account (RF-813, RN-11, INV-25, INV-29), all in the transaction of the request. One change at a
   * time per organization (advisory lock, as in the inbox) so that two administrators cannot leave the organization without one (`LAST_ADMIN`).
   * Order: the missions are reassigned first (the function checks the new responsible), then the role, the profile and the state. A field
   * that does not change anything (the same role, reactivating an active account) is `INVALID_STATE_TRANSITION` (D-U4).
   */
  async update(principal: Principal, userId: string, body: UpdateBody): Promise<OperationOutput<'updateUser'>> {
    const { orgId, userId: actorId } = viewerOf(principal);
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user-updates:${orgId}`}, 0))`);

    const { rows } = await this.tx.execute(sql`
      SELECT m.role, u.account_status, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid`);
    const current = (rows as unknown as { role: Item['role']; account_status: Item['accountStatus']; display_name: string }[])[0];
    if (!current) throw new DomainError('NOT_FOUND');

    const changesRole = body.role !== undefined;
    const changesStatus = body.accountStatus !== undefined;
    if ((changesRole && body.role === current.role) || (changesStatus && body.accountStatus === current.account_status)) {
      throw new DomainError('INVALID_STATE_TRANSITION', 'The change does not change anything');
    }
    const losesRole = changesRole && body.role !== current.role;
    const disables = changesStatus && body.accountStatus === 'disabled';

    if (current.role === 'admin' && current.account_status === 'active' && (losesRole || disables)) {
      const { rows: others } = await this.tx.execute(sql`
        SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = ${orgId}::uuid AND m.role = 'admin' AND m.status = 'active' AND u.account_status = 'active' AND m.user_id <> ${userId}::uuid`);
      if ((others as unknown as { n: number }[])[0]!.n === 0) throw new DomainError('LAST_ADMIN', 'The organization needs at least one active administrator');
    }

    if (current.role === 'coordinator' && (losesRole || disables)) {
      const { rows: open } = await this.tx.execute(sql`
        SELECT id FROM missions WHERE organization_id = ${orgId}::uuid AND coordinator_id = ${userId}::uuid AND status <> 'closed' ORDER BY id`);
      const missionIds = (open as unknown as { id: string }[]).map((r) => r.id);
      if (missionIds.length > 0) {
        if (!body.reassignMissionsTo) throw new DomainError('COORDINATOR_HAS_MISSIONS', 'The coordinator is responsible for missions that are not closed', { missionIds });
        try {
          await this.tx.execute(sql`SELECT admin_reassign_missions(${userId}::uuid, ${body.reassignMissionsTo}::uuid)`);
        } catch (error) {
          throw translate(error);
        }
      }
    }

    if (losesRole) {
      await this.tx.execute(sql`UPDATE memberships SET role = ${body.role}::member_role WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
      await this.audit.recordRoleChanged({ orgId, userId, actorUserId: actorId, from: current.role, to: body.role! });
      if (body.role === 'rescuer') {
        // D-U3: a person who was never a rescuer gets an incomplete profile; one who was keeps hers, hidden until now
        await this.tx.execute(sql`
          INSERT INTO rescuer_profiles (organization_id, user_id, full_name, status)
          SELECT ${orgId}::uuid, ${userId}::uuid, ${current.display_name}, 'incomplete'
           WHERE NOT EXISTS (SELECT 1 FROM rescuer_profiles WHERE organization_id = ${orgId}::uuid AND user_id = ${userId}::uuid)`);
      }
    }
    if (changesStatus) {
      try {
        await this.tx.execute(sql`SELECT admin_set_account_status(${userId}::uuid, ${body.accountStatus}::account_status)`);
      } catch (error) {
        throw translate(error);
      }
    }
    return this.detailIn(orgId, userId);
  }
}

/** What `admin_reassign_missions` and `admin_set_account_status` raise: a destination that is not an active coordinator (or `missions_guard`, INV-03) is the caller's mistake. */
function translate(error: unknown): Error {
  const pg = pgErrorOf(error);
  if (pg?.code === '22023' || pg?.code === '23000') {
    return new DomainError('VALIDATION_FAILED', 'Request validation failed', {
      issues: [{ path: 'reassignMissionsTo', code: 'invalid_value', message: 'The new responsible must be another active coordinator of the organization' }],
    });
  }
  if (pg?.code === '42501') return new DomainError('FORBIDDEN');
  return error instanceof Error ? error : new Error(String(error));
}
