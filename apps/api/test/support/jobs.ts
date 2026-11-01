import { sql } from 'drizzle-orm';
import { CalculationJobs, type JobKind } from '../../src/jobs/calculation-jobs.service.js';
import { DatabaseService } from '../../src/db/database.service.js';
import type { Principal } from '../../src/common/operation.js';
import type { TestApp } from './app.js';
import type { Member } from './fixtures.js';

/** What the tests of the jobs share: asking for a job the way the API will (inside a transaction of the coordinator). */
export function jobsOf(app: TestApp) {
  const database = app.app.get(DatabaseService);
  const jobs = app.app.get(CalculationJobs);
  const principalOf = (member: Member, orgId: string): Principal => ({
    userId: member.userId,
    orgId,
    role: 'coordinator',
    accountStatus: 'active',
    sessionId: Buffer.alloc(0),
    csrfToken: '',
  });
  return {
    database,
    jobs,
    /** Creates the job and puts it in the queue in one transaction; returns its id. */
    async request(member: Member, orgId: string, kind: JobKind = 'generate', params: unknown = { test: true }, missionId: string | null = null): Promise<string> {
      return database.withContext({ orgId, userId: member.userId, role: 'coordinator' }, () => jobs.create(principalOf(member, orgId), kind, params, missionId));
    },
    /** A transaction that asks for a job and then fails: the job must not exist afterwards. */
    async requestAndRollBack(member: Member, orgId: string): Promise<void> {
      await database.withContext({ orgId, userId: member.userId, role: 'coordinator' }, async (tx) => {
        await jobs.create(principalOf(member, orgId), 'generate', { test: true }, null);
        await tx.execute(sql`SELECT 1`);
        throw new Error('the request failed after asking for the job');
      });
    },
  };
}
