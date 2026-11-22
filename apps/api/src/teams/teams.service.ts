import { Inject, Injectable } from '@nestjs/common';
import type { AddTeamMembersRequest, CreateTeamRequest, ListTeamsQuery, OperationOutput, UpdateTeamRequest } from '@onway/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { pgErrorOf } from '../db/errors.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';

type Item = OperationOutput<'listTeams'>['items'][number];
type Detail = OperationOutput<'getTeam'>;
type Query = z.infer<typeof ListTeamsQuery>;
type CreateBody = z.infer<typeof CreateTeamRequest>;
type UpdateBody = z.infer<typeof UpdateTeamRequest>;
type AddBody = z.infer<typeof AddTeamMembersRequest>;

interface TeamRow {
  id: string;
  name: string;
  locality: string;
  code: string;
  status: Item['status'];
  member_count: number;
  created_at: string;
}

/** `%text%` for ILIKE with the wildcards of the text itself escaped, so that a search for `a_b` does not match `axb`. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** The people that count as members: active memberships of the organization that are not anonymized (INV-22). Contact data never leaves here (RN-21). */
const ACTIVE_MEMBER = sql`m.status = 'active' AND u.anonymized_at IS NULL`;

const toItem = (r: TeamRow): Item => ({ id: r.id, name: r.name, locality: r.locality, code: r.code, status: r.status, memberCount: r.member_count });

/** The two unique constraints of a team: its name (INV-23) and its code (D-E1) say in which field the clash is. */
function translateDuplicate(error: unknown): Error {
  const failure = pgErrorOf(error);
  if (failure?.code === '23505' && failure.constraint === 'teams_org_name_uq') return new DomainError('DUPLICATE_NAME', 'A team with that name already exists', { field: 'name' });
  if (failure?.code === '23505' && failure.constraint === 'teams_org_code_uq') return new DomainError('DUPLICATE_NAME', 'A team with that code already exists', { field: 'code' });
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Teams of the organization (RF-801, doc 02 §3.8). Reading is for the staff; writing is for the coordinator and the administrator (Q-12:
 * the registry roles and the policy `teams_write`). The filter by organization is the second defence behind the row policies (INV-01): a team
 * of another organization is a 404. Members are people of any role, active in the organization (D-E4); only their names leave here (RN-21).
 */
@Injectable()
export class TeamsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, query: Query): Promise<OperationOutput<'listTeams'>> {
    const { orgId } = viewerOf(principal);
    const filters: SQL[] = [sql`t.organization_id = ${orgId}::uuid`];
    if (query.status) filters.push(sql`t.status = ${query.status}::team_status`);
    if (query.q) filters.push(sql`(t.name ILIKE ${likePattern(query.q)} OR t.locality ILIKE ${likePattern(query.q)})`);
    const where = sql.join(filters, sql` AND `);

    const { rows: counted } = await this.tx.execute(sql`SELECT count(*)::int AS total FROM teams t WHERE ${where}`);
    const { rows } = await this.tx.execute(sql`
      SELECT t.id, t.name, t.locality, t.code, t.status::text AS status, ${sql.raw(isoUtc('t.created_at'))} AS created_at,
             (SELECT count(*)::int FROM team_members tm
                JOIN memberships m ON m.organization_id = tm.organization_id AND m.user_id = tm.user_id
                JOIN users u ON u.id = tm.user_id
               WHERE tm.team_id = t.id AND ${ACTIVE_MEMBER}) AS member_count
        FROM teams t WHERE ${where}
       ORDER BY lower(t.name), t.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    return { items: (rows as unknown as TeamRow[]).map(toItem), page: query.page, pageSize: query.pageSize, total: (counted as unknown as { total: number }[])[0]!.total };
  }

  async get(principal: Principal, teamId: string): Promise<OperationOutput<'getTeam'>> {
    return this.detailIn(viewerOf(principal).orgId, teamId);
  }

  /** The detail of a team of the organization, with its members by name; another organization's or a missing team is a 404. Also the answer of the writes. */
  private async detailIn(orgId: string, teamId: string): Promise<Detail> {
    const { rows } = await this.tx.execute(sql`
      SELECT t.id, t.name, t.locality, t.code, t.status::text AS status, ${sql.raw(isoUtc('t.created_at'))} AS created_at, 0 AS member_count
        FROM teams t WHERE t.id = ${teamId}::uuid AND t.organization_id = ${orgId}::uuid`);
    const row = (rows as unknown as TeamRow[])[0];
    if (!row) throw new DomainError('NOT_FOUND');
    const { rows: people } = await this.tx.execute(sql`
      SELECT u.id, u.display_name FROM team_members tm
        JOIN memberships m ON m.organization_id = tm.organization_id AND m.user_id = tm.user_id
        JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ${teamId}::uuid AND tm.organization_id = ${orgId}::uuid AND ${ACTIVE_MEMBER}
       ORDER BY lower(u.display_name), u.id`);
    const members = (people as unknown as { id: string; display_name: string }[]).map((p) => ({ id: p.id, displayName: p.display_name }));
    return { ...toItem(row), memberCount: members.length, members, createdAt: row.created_at };
  }

  async create(principal: Principal, body: CreateBody): Promise<OperationOutput<'createTeam'>> {
    const { orgId, userId } = viewerOf(principal);
    let id: string;
    try {
      const { rows } = await this.tx.execute(sql`INSERT INTO teams (organization_id, name, locality, code) VALUES (${orgId}::uuid, ${body.name}, ${body.locality}, ${body.code}) RETURNING id`);
      id = (rows as unknown as { id: string }[])[0]!.id;
    } catch (error) {
      throw translateDuplicate(error);
    }
    await this.audit.recordTeam({ orgId, teamId: id, action: 'team_created', actorUserId: userId, detail: { fields: ['name', 'locality', 'code'] } });
    return this.detailIn(orgId, id);
  }

  async update(principal: Principal, teamId: string, body: UpdateBody): Promise<OperationOutput<'updateTeam'>> {
    const { orgId, userId } = viewerOf(principal);
    await this.lockTeam(orgId, teamId);
    const sets: SQL[] = [];
    const fields: string[] = [];
    if (body.name !== undefined) {
      sets.push(sql`name = ${body.name}`);
      fields.push('name');
    }
    if (body.locality !== undefined) {
      sets.push(sql`locality = ${body.locality}`);
      fields.push('locality');
    }
    if (body.code !== undefined) {
      sets.push(sql`code = ${body.code}`);
      fields.push('code');
    }
    if (body.status !== undefined) {
      sets.push(sql`status = ${body.status}::team_status`);
      fields.push('status');
    }
    try {
      await this.tx.execute(sql`UPDATE teams SET ${sql.join(sets, sql`, `)} WHERE id = ${teamId}::uuid AND organization_id = ${orgId}::uuid`);
    } catch (error) {
      throw translateDuplicate(error);
    }
    await this.audit.recordTeam({ orgId, teamId, action: 'team_updated', actorUserId: userId, detail: { fields, ...(body.status !== undefined ? { status: body.status } : {}) } });
    return this.detailIn(orgId, teamId);
  }

  /**
   * Adds people to an active team (D-E5). Every `userId` must be an active member of the organization (any role, D-E4); if one is not, nothing is
   * added. Those who already belong are left as they are. A person who enters their FIRST team receives the code of the team in their alias
   * (Q-36): a single time, and `set_member_alias` never changes an alias that has one.
   */
  async addMembers(principal: Principal, teamId: string, body: AddBody): Promise<OperationOutput<'addTeamMembers'>> {
    const { orgId, userId: actorId } = viewerOf(principal);
    const team = await this.lockTeam(orgId, teamId);
    if (team.status !== 'active') throw new DomainError('INVALID_STATE_TRANSITION', 'An archived team does not admit new members');

    const wanted = [...new Set(body.userIds)];
    const { rows: valid } = await this.tx.execute(sql`
      SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ${orgId}::uuid AND m.user_id IN (${sql.join(
         wanted.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
         AND m.status = 'active' AND u.account_status = 'active' AND u.anonymized_at IS NULL`);
    const known = new Set((valid as unknown as { user_id: string }[]).map((r) => r.user_id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [{ path: 'userIds', code: 'invalid_value', message: 'Every person must be an active member of the organization' }],
      });
    }

    const added: string[] = [];
    for (const id of wanted) {
      const { rows } = await this.tx.execute(sql`
        INSERT INTO team_members (team_id, user_id, organization_id) VALUES (${teamId}::uuid, ${id}::uuid, ${orgId}::uuid)
        ON CONFLICT (team_id, user_id) DO NOTHING RETURNING user_id`);
      if (rows.length === 0) continue;
      added.push(id);
      const { rows: counts } = await this.tx.execute(sql`SELECT count(*)::int AS n FROM team_members WHERE user_id = ${id}::uuid AND organization_id = ${orgId}::uuid`);
      if ((counts as unknown as { n: number }[])[0]!.n === 1) await this.tx.execute(sql`SELECT set_member_alias(${id}::uuid, NULL, ${team.code})`);
    }
    if (added.length > 0) await this.audit.recordTeam({ orgId, teamId, action: 'team_members_added', actorUserId: actorId, detail: { userIds: added, count: added.length } });
    return this.detailIn(orgId, teamId);
  }

  /** Takes a person out of the team; the alias does not change (Q-36). Whoever was not a member, or a team of another organization, is a 404. */
  async removeMember(principal: Principal, teamId: string, memberId: string): Promise<void> {
    const { orgId, userId: actorId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`
      DELETE FROM team_members WHERE team_id = ${teamId}::uuid AND user_id = ${memberId}::uuid AND organization_id = ${orgId}::uuid RETURNING user_id`);
    if (rows.length === 0) throw new DomainError('NOT_FOUND');
    await this.audit.recordTeam({ orgId, teamId, action: 'team_member_removed', actorUserId: actorId, detail: { userId: memberId } });
  }

  /** The row of the team locked for the rest of the transaction (two writes of the same team do not cross), or a 404. */
  private async lockTeam(orgId: string, teamId: string): Promise<{ status: string; code: string }> {
    const { rows } = await this.tx.execute(sql`SELECT status::text AS status, code FROM teams WHERE id = ${teamId}::uuid AND organization_id = ${orgId}::uuid FOR UPDATE`);
    const row = (rows as unknown as { status: string; code: string }[])[0];
    if (!row) throw new DomainError('NOT_FOUND');
    return row;
  }
}
