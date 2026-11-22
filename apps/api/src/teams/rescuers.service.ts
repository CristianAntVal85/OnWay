import { Inject, Injectable } from '@nestjs/common';
import type { ListRescuersQuery, OperationOutput } from '@onway/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { viewerOf } from '../missions/mission-support.js';

type Query = z.infer<typeof ListRescuersQuery>;

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * The picker of rescuers for the members of a team (RF-801): active rescuers of the organization, by default only with the profile complete.
 * Name and active teams, nothing else: no contact, no document (RN-21, rule 3). The filter by organization is the second defence (INV-01).
 */
@Injectable()
export class RescuersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async list(principal: Principal, query: Query): Promise<OperationOutput<'listRescuers'>> {
    const { orgId } = viewerOf(principal);
    const filters: SQL[] = [sql`m.organization_id = ${orgId}::uuid`, sql`m.role = 'rescuer'`, sql`m.status = 'active'`, sql`u.account_status = 'active'`, sql`u.anonymized_at IS NULL`];
    if (query.profileComplete) filters.push(sql`EXISTS (SELECT 1 FROM rescuer_profiles p WHERE p.user_id = u.id AND p.organization_id = m.organization_id AND p.status = 'complete')`);
    if (query.q) filters.push(sql`u.display_name ILIKE ${likePattern(query.q)}`);
    if (query.teamId) filters.push(sql`EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.organization_id = m.organization_id AND tm.team_id = ${query.teamId}::uuid)`);
    const where = sql.join(filters, sql` AND `);

    const from = sql`FROM memberships m JOIN users u ON u.id = m.user_id WHERE ${where}`;
    const { rows: counted } = await this.tx.execute(sql`SELECT count(*)::int AS total ${from}`);
    const { rows } = await this.tx.execute(sql`
      SELECT u.id AS user_id, u.display_name,
             COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'locality', t.locality) ORDER BY lower(t.name), t.id)
                         FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.organization_id = tm.organization_id
                        WHERE tm.user_id = u.id AND tm.organization_id = m.organization_id AND t.status = 'active'), '[]'::json) AS teams
        ${from} ORDER BY lower(u.display_name), u.id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    const items = (rows as unknown as { user_id: string; display_name: string; teams: { id: string; name: string; locality: string }[] }[]).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      teams: r.teams,
    }));
    return { items, page: query.page, pageSize: query.pageSize, total: (counted as unknown as { total: number }[])[0]!.total };
  }
}
