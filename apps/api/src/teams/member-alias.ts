import { sql } from 'drizzle-orm';
import type { Tx } from '../db/database.service.js';

/**
 * Assigns the alias of a person (Q-36, D-E2): `base` comes from `aliasBase` (TypeScript), the database resolves the collisions and keeps the
 * alias fixed (`set_member_alias`). The locality code is that of the first team the person belongs to, if any; it is added once.
 */
export async function assignMemberAlias(tx: Tx, orgId: string, userId: string, base: string): Promise<void> {
  if (!/^[a-z]+$/.test(base)) return;
  const { rows } = await tx.execute(sql`
    SELECT t.code FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.organization_id = tm.organization_id
     WHERE tm.user_id = ${userId}::uuid AND tm.organization_id = ${orgId}::uuid ORDER BY tm.added_at, t.id LIMIT 1`);
  const code = (rows as unknown as { code: string }[])[0]?.code ?? null;
  await tx.execute(sql`SELECT set_member_alias(${userId}::uuid, ${base}, ${code})`);
}
