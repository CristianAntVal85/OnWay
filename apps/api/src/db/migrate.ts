import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { DbConnection } from './config.js';

const JOURNAL = join('meta', '_journal.json');

/** `MIGRATIONS_DIR`, or the first `db/migrations` found walking up from this file. */
export function resolveMigrationsFolder(env: Record<string, string | undefined> = process.env): string {
  if (env.MIGRATIONS_DIR) return resolve(env.MIGRATIONS_DIR);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, 'db', 'migrations');
    if (existsSync(join(candidate, JOURNAL))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('db/migrations not found; set MIGRATIONS_DIR');
    dir = parent;
  }
}

/**
 * Applies 0002-0011 as `onway_owner` with the Drizzle migrator. 0001 (extensions and roles) needs a
 * superuser and runs at database start-up (infra/db/init).
 */
export async function runMigrations(connection: DbConnection, migrationsFolder = resolveMigrationsFolder()): Promise<void> {
  const pool = new pg.Pool({ ...connection, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
