import type { OperationOutput } from '@onway/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/database.service.js';
import { skills } from '../db/schema.js';

export type SkillView = OperationOutput<'listMySkills'>['items'][number];
export type SkillRow = typeof skills.$inferSelect;

export const toSkillView = (row: SkillRow): SkillView => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  issuer: row.issuer,
  issuedOn: row.issuedOn,
  expiresOn: row.expiresOn,
  hasCertificate: row.certificateFileId !== null, // the file itself never leaves here (rule 3): it is asked for apart
});

/** Courses first, then by name: the one order `listMySkills` and `getMyProfile.skills` share. */
export async function listSkillsOf(tx: Tx, profileId: string): Promise<SkillView[]> {
  const rows = await tx
    .select()
    .from(skills)
    .where(eq(skills.profileId, profileId))
    .orderBy(sql`CASE WHEN ${skills.kind} = 'course' THEN 0 ELSE 1 END`, asc(skills.name), asc(skills.id));
  return rows.map(toSkillView);
}
