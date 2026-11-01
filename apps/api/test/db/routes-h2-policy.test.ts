import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// Migration 0012 (H2): the road type "unknown" for routes that no engine has classified, and the upload of route files
// (GPX/KML) only by the coordinator, through the real `onway_app` login.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const ids = { admin: randomUUID(), coordinator: randomUUID(), rescuer: randomUUID(), route: randomUUID(), version: randomUUID() };

type Role = 'admin' | 'coordinator' | 'rescuer';
const as = (role: Role) => ({ orgId, userId: ids[role], role });

/** Runs `fn` in a transaction of `onway_app` with the context of the real API (doc 05 §6.1); always rolled back. */
async function asApp<T>(context: { orgId: string; userId: string; role: Role }, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)`, [context.orgId, context.userId, context.role]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const insertRouteFile = (client: pg.PoolClient, createdBy: string) =>
  client.query(
    `INSERT INTO files (organization_id, purpose, content_type, size_bytes, storage_key, sha256, created_by)
     VALUES ($1, 'route_import', 'application/gpx+xml', 1200, $2, decode('00', 'hex'), $3)`,
    [orgId, `ab/${randomUUID()}`, createdBy],
  );

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, 'Org H2', 'ES', $2)`, [orgId, `INV-${randomUUID()}`]);
  for (const role of ['admin', 'coordinator', 'rescuer'] as const) {
    await owner.query(`INSERT INTO users (id, email, password_hash, display_name, account_status) VALUES ($1, $2, 'x', $3, 'active')`, [ids[role], `${role}-${randomUUID()}@example.org`, `Fictitious ${role}`]);
    await owner.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [orgId, ids[role], role]);
  }
  await owner.query(`INSERT INTO routes (id, organization_id, name, created_by) VALUES ($1, $2, 'Route', $3)`, [ids.route, orgId, ids.coordinator]);
  await owner.query(
    `INSERT INTO route_versions (id, organization_id, route_id, version_number, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct, provenance, created_by)
     VALUES ($1, $2, $3, 1, 'LINESTRING Z (0 0 100, 0.01 0.01 150)', 1500, 50, 0, 100, 150, 3.3, 'imported', $4)`,
    [ids.version, orgId, ids.route, ids.coordinator],
  );
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('road type "unknown" (migration 0012, P1)', () => {
  it('is the last value of road_type and the earlier ones are intact', async () => {
    const { rows } = await owner.query<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'road_type'::regtype ORDER BY enumsortorder`);
    expect(rows.map((row) => row.enumlabel)).toEqual(['road', 'track', 'path', 'offtrail', 'unknown']);
  });

  it('a segment of an imported route can be unclassified, and the coordinator reads it back as such', async () => {
    await owner.query(
      `INSERT INTO route_segments (organization_id, version_id, position, geom, road_type, distance_m, ascent_m, descent_m)
       VALUES ($1, $2, 0, 'LINESTRING Z (0 0 100, 0.01 0.01 150)', 'unknown', 1500, 50, 0)`,
      [orgId, ids.version],
    );
    await asApp(as('coordinator'), async (client) => {
      const { rows } = await client.query<{ road_type: string }>(`SELECT road_type FROM route_segments WHERE version_id = $1`, [ids.version]);
      expect(rows).toEqual([{ road_type: 'unknown' }]);
    });
  });
});

describe('route files are uploaded only by the coordinator (migration 0012, D-H2-10)', () => {
  it('the coordinator inserts a route file', async () => {
    await asApp(as('coordinator'), async (client) => {
      expect((await insertRouteFile(client, ids.coordinator)).rowCount).toBe(1);
    });
  });

  it('the administrator cannot insert a route file, and the rescuer neither', async () => {
    await asApp(as('admin'), async (client) => {
      await expect(insertRouteFile(client, ids.admin)).rejects.toThrow(/row-level security/);
    });
    await asApp(as('rescuer'), async (client) => {
      await expect(insertRouteFile(client, ids.rescuer)).rejects.toThrow(/row-level security/);
    });
  });

  it('the administrator still reads the route files of the organization', async () => {
    const fileId = randomUUID();
    await owner.query(
      `INSERT INTO files (id, organization_id, purpose, content_type, size_bytes, storage_key, sha256, created_by)
       VALUES ($1, $2, 'route_import', 'application/gpx+xml', 900, $3, decode('01', 'hex'), $4)`,
      [fileId, orgId, `cd/${randomUUID()}`, ids.coordinator],
    );
    await asApp(as('admin'), async (client) => {
      expect((await client.query(`SELECT 1 FROM files WHERE id = $1`, [fileId])).rowCount).toBe(1);
    });
  });

  it('the rescuer still inserts her own certificate (the policy of H5 is intact)', async () => {
    await asApp(as('rescuer'), async (client) => {
      const result = await client.query(
        `INSERT INTO files (organization_id, owner_user_id, purpose, content_type, size_bytes, storage_key, sha256, created_by)
         VALUES ($1, $2, 'certificate', 'application/pdf', 2000, $3, decode('02', 'hex'), $2)`,
        [orgId, ids.rescuer, `ef/${randomUUID()}`],
      );
      expect(result.rowCount).toBe(1);
    });
  });
});
