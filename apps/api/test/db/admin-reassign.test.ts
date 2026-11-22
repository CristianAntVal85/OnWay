import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// Migration 0014 (H5-usuarios, D-U1): `admin_reassign_missions`, through the real `onway_app` login. Only the administrator reassigns,
// only the not-closed missions of the person (INV-11), to an active coordinator of the organization (INV-03), with one audit row per
// mission; and the coordinator still cannot change a role (INV-29).
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const otherOrg = randomUUID();
const ids = {
  admin: randomUUID(),
  from: randomUUID(),
  to: randomUUID(),
  disabledCoordinator: randomUUID(),
  rescuer: randomUUID(),
  foreign: randomUUID(),
  planning: randomUUID(),
  active: randomUUID(),
  closed: randomUUID(),
};

type Role = 'admin' | 'coordinator' | 'rescuer';
const as = (role: Role, userId: string) => ({ orgId, userId, role });

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

const reassign = async (client: pg.PoolClient, from: string, to: string) =>
  (await client.query<{ admin_reassign_missions: string }>('SELECT admin_reassign_missions($1, $2)', [from, to])).rows.map((r) => r.admin_reassign_missions);

async function addUser(id: string, org: string, role: Role, status: 'active' | 'disabled' = 'active') {
  await owner.query(`INSERT INTO users (id, email, password_hash, display_name, account_status) VALUES ($1, $2, 'x', $3, $4)`, [id, `${role}-${randomUUID()}@example.org`, `Fictitious ${role}`, status]);
  await owner.query(`INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, $4)`, [org, id, role, status]);
}

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, 'Org reassign', 'ES', $2), ($3, 'Other org', 'ES', $4)`, [orgId, `INV-${randomUUID()}`, otherOrg, `INV-${randomUUID()}`]);
  await addUser(ids.admin, orgId, 'admin');
  await addUser(ids.from, orgId, 'coordinator');
  await addUser(ids.to, orgId, 'coordinator');
  await addUser(ids.disabledCoordinator, orgId, 'coordinator', 'disabled');
  await addUser(ids.rescuer, orgId, 'rescuer');
  await addUser(ids.foreign, otherOrg, 'coordinator');
  const mission = (id: string, status: string) =>
    owner.query(
      `INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at) VALUES ($1, $2, $3, $4, $5, 'POINT Z (0 0 0)', 'map', $4, ${status === 'planning' ? 'NULL' : 'now()'})`,
      [id, orgId, `Mission ${status}`, ids.from, status],
    );
  await mission(ids.planning, 'planning');
  await mission(ids.active, 'active');
  await owner.query(`INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at, closed_at) VALUES ($1, $2, 'Mission closed', $3, 'closed', 'POINT Z (0 0 0)', 'map', $3, now(), now())`, [ids.closed, orgId, ids.from]);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('admin_reassign_missions (0014, RN-11, INV-03, INV-11)', () => {
  it('the administrator moves only the not-closed missions and leaves one mission_updated row each', async () => {
    await asApp(as('admin', ids.admin), async (client) => {
      const moved = await reassign(client, ids.from, ids.to);
      expect(moved.sort()).toEqual([ids.planning, ids.active].sort());
      const { rows } = await client.query<{ id: string; coordinator_id: string }>('SELECT id, coordinator_id FROM missions');
      const by = Object.fromEntries(rows.map((r) => [r.id, r.coordinator_id]));
      expect(by[ids.planning]).toBe(ids.to);
      expect(by[ids.active]).toBe(ids.to);
      expect(by[ids.closed]).toBe(ids.from);

      const { rows: audit } = await client.query<{ entity_id: string; actor_user_id: string; detail: Record<string, unknown> }>(
        `SELECT entity_id, actor_user_id, detail FROM audit_log WHERE action = 'mission_updated' AND entity_type = 'mission' ORDER BY entity_id`,
      );
      expect(audit.map((a) => a.entity_id).sort()).toEqual([ids.planning, ids.active].sort());
      for (const row of audit) {
        expect(row.actor_user_id).toBe(ids.admin);
        expect(row.detail).toEqual({ fields: ['coordinatorId'], reassignedFrom: ids.from, reassignedTo: ids.to });
      }
    });
  });

  it('a person with no open missions yields an empty list and no audit rows', async () => {
    await asApp(as('admin', ids.admin), async (client) => {
      expect(await reassign(client, ids.to, ids.from)).toEqual([]);
      expect((await client.query(`SELECT 1 FROM audit_log WHERE action = 'mission_updated'`)).rowCount).toBe(0);
    });
  });

  it('a coordinator or a rescuer who calls the function gets an error and nothing moves', async () => {
    await asApp(as('coordinator', ids.from), async (client) => {
      await expect(reassign(client, ids.from, ids.to)).rejects.toThrow(/administrador/);
    });
    await asApp(as('rescuer', ids.rescuer), async (client) => {
      await expect(reassign(client, ids.from, ids.to)).rejects.toThrow(/administrador/);
    });
    expect((await owner.query(`SELECT 1 FROM missions WHERE coordinator_id = $1`, [ids.from])).rowCount).toBe(3);
  });

  it('the destination must be an active coordinator of the organization other than the origin', async () => {
    for (const bad of [ids.rescuer, ids.admin, ids.disabledCoordinator, ids.from, ids.foreign, randomUUID()]) {
      await asApp(as('admin', ids.admin), async (client) => {
        await expect(reassign(client, ids.from, bad)).rejects.toThrow(/responsable/);
      });
    }
  });

  it('missions of another organization are never touched', async () => {
    await asApp(as('admin', ids.admin), async (client) => {
      // The administrator's context is org A: asking to move the coordinator of org B moves nothing.
      expect(await reassign(client, ids.foreign, ids.to)).toEqual([]);
    });
  });
});

describe('INV-29: only the administrator changes a role', () => {
  it('a coordinator changes no membership role (0 rows) and the administrator does', async () => {
    await asApp(as('coordinator', ids.from), async (client) => {
      expect((await client.query(`UPDATE memberships SET role = 'admin' WHERE user_id = $1`, [ids.from])).rowCount).toBe(0);
      expect((await client.query(`UPDATE memberships SET role = 'coordinator' WHERE user_id = $1`, [ids.rescuer])).rowCount).toBe(0);
    });
    await asApp(as('admin', ids.admin), async (client) => {
      expect((await client.query(`UPDATE memberships SET role = 'coordinator' WHERE user_id = $1`, [ids.rescuer])).rowCount).toBe(1);
    });
  });
});

describe('the function is closed to PUBLIC', () => {
  it('only onway_app (and the owner) can execute it', async () => {
    const { rows } = await owner.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.routine_privileges WHERE routine_name = 'admin_reassign_missions' AND privilege_type = 'EXECUTE' ORDER BY grantee`,
    );
    expect(rows.map((r) => r.grantee)).not.toContain('PUBLIC');
    expect(rows.map((r) => r.grantee)).toContain('onway_app');
  });
});
