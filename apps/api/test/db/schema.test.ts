import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

let db: TestDatabase;

async function query<T extends pg.QueryResultRow>(connection: TestDatabase['owner'], text: string): Promise<T[]> {
  const client = new pg.Client(connection);
  await client.connect();
  try {
    return (await client.query<T>(text)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
});

afterAll(async () => {
  await db?.stop();
});

describe('migrations (D-H0-04)', () => {
  it('apply 0002-0009 on an empty PostGIS database', async () => {
    const rows = await query<{ n: string }>(db.owner, 'SELECT count(*) AS n FROM drizzle.__drizzle_migrations');
    expect(Number(rows[0]?.n)).toBe(8);
    const postgis = await query<{ v: string }>(db.owner, 'SELECT postgis_version() AS v');
    expect(postgis[0]?.v).toMatch(/^3\.4/);
  });

  it('applying them a second time changes nothing', async () => {
    const before = await query(db.owner, 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id');
    await runMigrations(db.owner);
    const after = await query(db.owner, 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id');
    expect(after).toEqual(before);
  });
});

describe('roles (doc 05 §6.2, rule 1)', () => {
  it('onway_app logs in, is not superuser, has no BYPASSRLS and owns no table', async () => {
    const [role] = await query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; me: string }>(
      db.app,
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, current_user AS me FROM pg_roles WHERE rolname = 'onway_app'",
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, me: 'onway_app' });

    const owned = await query<{ relname: string }>(
      db.owner,
      "SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'onway_app' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')",
    );
    expect(owned).toEqual([]);

    const tables = await query<{ n: string }>(db.owner, "SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'spatial_ref_sys' AND tableowner = 'onway_owner'");
    expect(Number(tables[0]?.n)).toBeGreaterThan(0);
  });

  it('onway_platform cannot log in and onway_owner is not a superuser', async () => {
    const rows = await query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean }>(
      db.owner,
      "SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname IN ('onway_owner', 'onway_platform') ORDER BY rolname",
    );
    expect(rows).toEqual([
      { rolname: 'onway_owner', rolcanlogin: true, rolsuper: false },
      { rolname: 'onway_platform', rolcanlogin: false, rolsuper: false },
    ]);
  });
});

describe('schema tests of doc 05 §11 on real PostGIS', () => {
  it('118 checks pass and none fail', async () => {
    const seed = await db.psqlFile('/onway/tests/seed_and_tests.sql');
    expect(seed.match(/ERROR/gi) ?? []).toEqual([]);

    const output = await db.psqlFile('/onway/tests/run_tests.sql');
    const results = [...output.matchAll(/RESULT\|(PASS|FAIL)\|(.*)/g)].map((m) => ({ status: m[1], label: m[2] }));
    const failed = results.filter((r) => r.status === 'FAIL');
    const passed = results.length - failed.length;
    console.info(`schema tests: ${passed} PASS, ${failed.length} FAIL`);
    expect(output.match(/ERROR.*/g) ?? []).toEqual([]);
    expect(failed).toEqual([]);
    expect(results.filter((r) => r.status === 'PASS')).toHaveLength(118);
  });
});
