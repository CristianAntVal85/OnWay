import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { DbConnection } from '../../src/db/config.js';

export const POSTGIS_IMAGE = 'postgis/postgis:16-3.4';
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const secret = () => randomBytes(24).toString('base64url');

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  owner: DbConnection;
  app: DbConnection;
  /** Runs a SQL file already copied to /onway/tests as `onway_owner`; returns psql's combined output. */
  psqlFile(file: string): Promise<string>;
  stop(): Promise<void>;
}

/**
 * Real PostGIS, started the same way as `docker compose` will: 0001 and the role passwords are applied
 * by infra/db/init/10-onway-roles.sh as superuser at first start. Migrations 0002-0012 are NOT applied here.
 */
export async function startDatabase(): Promise<TestDatabase> {
  const database = 'onway';
  const ownerPassword = secret();
  const appPassword = secret();
  const file = (path: string) => readFile(join(repoRoot, path), 'utf8');

  const container = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase(database)
    .withUsername('postgres')
    .withPassword(secret())
    .withEnvironment({
      ONWAY_MIGRATION_0001: '/onway/0001_extensions_roles.sql',
      ONWAY_OWNER_PASSWORD_FILE: '/onway/secrets/owner_password',
      ONWAY_APP_PASSWORD_FILE: '/onway/secrets/app_password',
    })
    .withCopyContentToContainer([
      { content: await file('db/migrations/0001_extensions_roles.sql'), target: '/onway/0001_extensions_roles.sql', mode: 0o644 },
      { content: ownerPassword, target: '/onway/secrets/owner_password', mode: 0o644 },
      { content: appPassword, target: '/onway/secrets/app_password', mode: 0o644 },
      { content: await file('infra/db/init/10-onway-roles.sh'), target: '/docker-entrypoint-initdb.d/10-onway-roles.sh', mode: 0o755 },
      { content: await file('db/tests/seed_and_tests.sql'), target: '/onway/tests/seed_and_tests.sql', mode: 0o644 },
      { content: await file('db/tests/run_tests.sql'), target: '/onway/tests/run_tests.sql', mode: 0o644 },
    ])
    .start();

  const base = { host: container.getHost(), port: container.getPort(), database };
  return {
    container,
    owner: { ...base, user: 'onway_owner', password: ownerPassword },
    app: { ...base, user: 'onway_app', password: appPassword },
    async psqlFile(path) {
      const result = await container.exec(['psql', '-q', '-U', 'onway_owner', '-d', database, '-f', path]);
      return `${result.stdout}\n${result.stderr}`;
    },
    stop: async () => {
      await container.stop();
    },
  };
}
