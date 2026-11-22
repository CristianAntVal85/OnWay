import { Inject, Injectable } from '@nestjs/common';
import type { ListUsersQuery, OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';
import { listSkillsOf } from '../profile/skill-rows.js';

type Item = OperationOutput<'listUsers'>['items'][number];
type Query = z.infer<typeof ListUsersQuery>;

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
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

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
}
