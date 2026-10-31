import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// Migration 0010 (P3): the staff reads the `mission` rows of their organization from audit_log, and nothing else.
// The administrator keeps reading everything of the organization (audit_select, 0008); a rescuer reads none of these.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgA = randomUUID();
const orgB = randomUUID();
const people = { adminA: randomUUID(), coordinatorA: randomUUID(), rescuerA: randomUUID(), coordinatorB: randomUUID() };
const rows: Record<string, number> = {};

type Role = 'admin' | 'coordinator' | 'rescuer';

/** Runs `fn` in a transaction of `onway_app` with the context of the real API (doc 05 §6.1). */
async function asApp<T>(context: { orgId: string; userId: string; role: Role } | null, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    if (context) await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)`, [context.orgId, context.userId, context.role]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const seen = (context: Parameters<typeof asApp>[0]) =>
  asApp(context, async (client) => (await client.query<{ id: string }>('SELECT id FROM audit_log ORDER BY id')).rows.map((r) => Number(r.id)));

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  // Audit rows are written as owner (the policy is read-only): two organizations, several entity types.
  const insert = async (key: string, org: string, entityType: string, subject: string | null = null) => {
    const { rows: inserted } = await owner.query<{ id: string }>(
      `INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id, subject_user_id) VALUES ($1, $2, $3, 'test', $4, $5) RETURNING id`,
      [org, entityType, randomUUID(), people.coordinatorA, subject],
    );
    rows[key] = Number(inserted[0]!.id);
  };
  await insert('missionA', orgA, 'mission');
  await insert('missionA2', orgA, 'mission');
  await insert('missionB', orgB, 'mission');
  await insert('sensitiveA', orgA, 'rescuer_sensitive', people.rescuerA);
  await insert('userA', orgA, 'user');
  await insert('signupA', orgA, 'signup_request');
  await insert('certificateA', orgA, 'skill', people.rescuerA);
  await insert('missionAboutRescuerA', orgA, 'mission', people.rescuerA);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('audit_mission_staff (migration 0010, P3)', () => {
  it('is one permissive, read-only policy for onway_app on audit_log', async () => {
    const { rows: policies } = await owner.query<{ policyname: string; cmd: string; permissive: string; roles: string[]; qual: string }>(
      `SELECT policyname, cmd, permissive, roles::text[] AS roles, qual FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_mission_staff'`,
    );
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({ cmd: 'SELECT', permissive: 'PERMISSIVE', roles: ['onway_app'] });
    expect(policies[0]!.qual).toContain("entity_type = 'mission'");
  });

  it('a coordinator reads exactly the mission rows of their own organization', async () => {
    const ids = await seen({ orgId: orgA, userId: people.coordinatorA, role: 'coordinator' });
    expect(ids).toEqual([rows.missionA, rows.missionA2, rows.missionAboutRescuerA].map(Number));
  });

  it('a coordinator reads no row of another entity type (sensitive data, users, signups, certificates)', async () => {
    const ids = await seen({ orgId: orgA, userId: people.coordinatorA, role: 'coordinator' });
    for (const key of ['sensitiveA', 'userA', 'signupA', 'certificateA']) expect(ids).not.toContain(rows[key]);
  });

  it('a coordinator of another organization reads only their own mission rows, never those of A', async () => {
    const ids = await seen({ orgId: orgB, userId: people.coordinatorB, role: 'coordinator' });
    expect(ids).toEqual([rows.missionB]);
  });

  it('a rescuer reads no mission row, not even one that names them as subject; they still read the accesses to their data', async () => {
    const ids = await seen({ orgId: orgA, userId: people.rescuerA, role: 'rescuer' });
    expect(ids).not.toContain(rows.missionA);
    expect(ids).not.toContain(rows.missionA2);
    // audit_select (0008) already lets them see the rows where they are the subject; 0010 adds nothing for them.
    expect(ids).toEqual([rows.sensitiveA, rows.certificateA, rows.missionAboutRescuerA].map(Number));
  });

  it('with no context at all nothing is visible', async () => {
    expect(await seen(null)).toEqual([]);
  });

  it('the administrator keeps reading the whole audit log of the organization, and only that', async () => {
    const ids = await seen({ orgId: orgA, userId: people.adminA, role: 'admin' });
    expect(ids).toEqual(Object.entries(rows).filter(([key]) => key !== 'missionB').map(([, id]) => id));
  });

  it('is read-only: staff still cannot change or delete the audit log, and cannot write a row for someone else', async () => {
    const context = { orgId: orgA, userId: people.coordinatorA, role: 'coordinator' as const };
    await expect(asApp(context, (client) => client.query(`UPDATE audit_log SET action = 'x' WHERE id = $1`, [rows.missionA]))).rejects.toThrow();
    await expect(asApp(context, (client) => client.query(`DELETE FROM audit_log WHERE id = $1`, [rows.missionA]))).rejects.toThrow();
    await expect(
      asApp(context, (client) =>
        client.query(`INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_user_id) VALUES ($1, 'mission', $2, 'x', $3)`, [orgA, randomUUID(), people.adminA]),
      ),
    ).rejects.toThrow();
  });
});
