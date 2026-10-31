import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// Migration 0011 (Q-14 = no): through the real `onway_app` login, the administrator reads missions and routes but writes
// none of it; only the coordinator writes; the rescuer keeps offering and withdrawing; INV-03 no longer accepts an administrator.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const ids = { admin: randomUUID(), coordinator: randomUUID(), rescuer: randomUUID(), mission: randomUUID(), point: randomUUID(), route: randomUUID(), team: randomUUID() };

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

const insertMission = (client: pg.PoolClient, responsible: string) =>
  client.query(
    `INSERT INTO missions (organization_id, name, coordinator_id, target, target_source, created_by) VALUES ($1, $2, $3, 'POINT Z (0 0 0)', 'map', $4)`,
    [orgId, `Mission ${randomUUID()}`, responsible, ids.coordinator],
  );

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, 'Org Q14', 'ES', $2)`, [orgId, `INV-${randomUUID()}`]);
  for (const role of ['admin', 'coordinator', 'rescuer'] as const) {
    await owner.query(`INSERT INTO users (id, email, password_hash, display_name, account_status) VALUES ($1, $2, 'x', $3, 'active')`, [ids[role], `${role}-${randomUUID()}@example.org`, `Fictitious ${role}`]);
    await owner.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [orgId, ids[role], role]);
  }
  await owner.query(`INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at) VALUES ($1, $2, 'Active mission', $3, 'active', 'POINT Z (0 0 0)', 'map', $3, now())`, [ids.mission, orgId, ids.coordinator]);
  await owner.query(`INSERT INTO mission_points (id, organization_id, mission_id, kind, name, geom) VALUES ($1, $2, $3, 'origin', 'Origin', 'POINT Z (0 0 0)')`, [ids.point, orgId, ids.mission]);
  await owner.query(`INSERT INTO routes (id, organization_id, name, created_by) VALUES ($1, $2, 'Route', $3)`, [ids.route, orgId, ids.coordinator]);
  await owner.query(`INSERT INTO teams (id, organization_id, name, locality) VALUES ($1, $2, 'Team', 'Locality')`, [ids.team, orgId]);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('missions and routes are written only by the coordinator (migration 0011, Q-14)', () => {
  it('the administrator still reads missions, points and routes of the organization', async () => {
    await asApp(as('admin'), async (client) => {
      expect((await client.query('SELECT 1 FROM missions')).rowCount).toBe(1);
      expect((await client.query('SELECT 1 FROM mission_points')).rowCount).toBe(1);
      expect((await client.query('SELECT 1 FROM routes')).rowCount).toBe(1);
    });
  });

  it('the administrator cannot create a mission, a point or a route, and changes or deletes zero existing rows', async () => {
    await asApp(as('admin'), async (client) => {
      await expect(insertMission(client, ids.coordinator)).rejects.toThrow(/row-level security/);
    });
    await asApp(as('admin'), async (client) => {
      await expect(client.query(`INSERT INTO mission_points (organization_id, mission_id, kind, name, geom) VALUES ($1, $2, 'waypoint', 'x', 'POINT Z (0 0 0)')`, [orgId, ids.mission])).rejects.toThrow(/row-level security/);
    });
    await asApp(as('admin'), async (client) => {
      await expect(client.query(`INSERT INTO routes (organization_id, name, created_by) VALUES ($1, 'x', $2)`, [orgId, ids.admin])).rejects.toThrow(/row-level security/);
    });
    await asApp(as('admin'), async (client) => {
      expect((await client.query(`UPDATE missions SET name = 'Renamed' WHERE id = $1`, [ids.mission])).rowCount).toBe(0);
      expect((await client.query(`UPDATE routes SET name = 'Renamed' WHERE id = $1`, [ids.route])).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM mission_points WHERE id = $1`, [ids.point])).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM missions WHERE id = $1`, [ids.mission])).rowCount).toBe(0);
    });
  });

  it('the coordinator creates, edits and deletes as before', async () => {
    await asApp(as('coordinator'), async (client) => {
      await insertMission(client, ids.coordinator);
      expect((await client.query(`UPDATE missions SET name = 'Renamed' WHERE id = $1`, [ids.mission])).rowCount).toBe(1);
      expect((await client.query(`UPDATE routes SET name = 'Renamed' WHERE id = $1`, [ids.route])).rowCount).toBe(1);
      expect((await client.query(`DELETE FROM mission_points WHERE id = $1`, [ids.point])).rowCount).toBe(1);
    });
  });

  it('the administrator keeps managing teams (Q-12)', async () => {
    await asApp(as('admin'), async (client) => {
      expect((await client.query(`UPDATE teams SET name = 'Renamed' WHERE id = $1`, [ids.team])).rowCount).toBe(1);
    });
  });

  it('the rescuer writes no mission data, and the offer and withdraw policies are still there', async () => {
    await asApp(as('rescuer'), async (client) => {
      await expect(client.query(`DELETE FROM mission_points WHERE id = $1`, [ids.point])).resolves.toMatchObject({ rowCount: 0 });
      await expect(insertMission(client, ids.coordinator)).rejects.toThrow(/row-level security/);
    });
    const { rows } = await owner.query<{ policyname: string; cmd: string }>(
      `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'participations' AND policyname IN ('part_offer', 'part_withdraw') ORDER BY policyname`,
    );
    expect(rows).toEqual([
      { policyname: 'part_offer', cmd: 'INSERT' },
      { policyname: 'part_withdraw', cmd: 'UPDATE' },
    ]);
  });

  it('INV-03: an administrator cannot be the responsible of a mission, on insert or update', async () => {
    await asApp(as('coordinator'), async (client) => {
      await expect(insertMission(client, ids.admin)).rejects.toThrow(/INV-03/);
    });
    await asApp(as('coordinator'), async (client) => {
      await expect(client.query(`UPDATE missions SET coordinator_id = $1 WHERE id = $2`, [ids.admin, ids.mission])).rejects.toThrow(/INV-03/);
    });
  });
});
