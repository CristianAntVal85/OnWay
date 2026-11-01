import pg from 'pg';
import { PgBoss } from 'pg-boss';
import type { DbConnection } from '../db/config.js';
import { BOSS_SCHEMA, CALCULATE_QUEUE_OPTIONS } from './pg-boss-queue.js';
import { CALCULATE_QUEUE } from './queue.js';

/**
 * Installs (or brings up to date) the pg-boss schema and the calculation queue, as `onway_owner`, and gives the application role
 * what it needs to send and take jobs (P1). pg-boss creates its own tables, functions and partitions, which is DDL: `onway_app`
 * cannot do it, so the migrator does it once and the running processes start with `createSchema: false, migrate: false`.
 * The queue holds only identifiers (job, organization, user): no personal data and nothing a policy has to protect.
 */
export async function installJobQueue(owner: DbConnection, appRole = 'onway_app'): Promise<void> {
  const { host, port, database, user, password } = owner;
  const boss = new PgBoss({ host, port, database, user, password, schema: BOSS_SCHEMA, max: 2, supervise: false, schedule: false });
  boss.on('error', (error: Error) => console.error(`pg-boss (install): ${error.message}`));
  await boss.start();
  try {
    await boss.createQueue(CALCULATE_QUEUE, { ...CALCULATE_QUEUE_OPTIONS });
  } finally {
    await boss.stop({ graceful: true, close: true });
  }

  const client = new pg.Client({ host, port, database, user, password });
  await client.connect();
  try {
    const role = `"${appRole.replace(/"/g, '""')}"`;
    const schema = `"${BOSS_SCHEMA}"`;
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${role}`);
    // Partitions and functions that a later pg-boss migration creates, as the owner, reach the application role too.
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT EXECUTE ON FUNCTIONS TO ${role}`);
  } finally {
    await client.end();
  }
}
