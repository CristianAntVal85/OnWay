import type { TestProject } from 'vitest/node';
import type { DbConnection } from '../../src/db/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from '../db/fixture.js';

declare module 'vitest' {
  export interface ProvidedContext {
    database: { owner: DbConnection; app: DbConnection };
  }
}

let database: TestDatabase | undefined;

/** One real PostGIS for the whole API suite, migrated like `docker compose` does (D-H0-04, D-H0-05). */
export async function setup(project: TestProject): Promise<void> {
  database = await startDatabase();
  await runMigrations(database.owner);
  project.provide('database', { owner: database.owner, app: database.app });
}

export async function teardown(): Promise<void> {
  await database?.stop();
}
