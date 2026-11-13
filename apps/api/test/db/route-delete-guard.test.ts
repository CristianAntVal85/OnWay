import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// Issue #17, migration 0013 (INV-04 and INV-07): through the real `onway_app` login, a validated version is deleted only together with
// its route, and only when the route is archived and is in no mission, closed ones included. Everything else about INV-04 stays as it was.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const otherOrgId = randomUUID();
const ids = { admin: randomUUID(), coordinator: randomUUID(), rescuer: randomUUID(), otherCoordinator: randomUUID() };
const LINE = 'LINESTRING Z (0 0 100, 0.01 0.01 150)';

type Role = 'admin' | 'coordinator' | 'rescuer';
interface Context {
  orgId: string;
  userId: string;
  role: Role;
}
const as = (role: Role): Context => ({ orgId, userId: ids[role], role });

/** Runs `fn` in a transaction of `onway_app` with the context of the real API (doc 05 §6.1); always rolled back. */
async function asApp<T>(context: Context, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

async function mission(status: 'planning' | 'active' | 'closed'): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, 'POINT Z (0 0 0)', 'map', $4, ${status === 'planning' ? 'NULL' : 'now()'}, ${status === 'closed' ? 'now()' : 'NULL'})`,
    [id, orgId, `Mission ${randomUUID()}`, ids.coordinator, status],
  );
  return id;
}

interface World {
  route: string;
  validated: string;
  draft: string | null;
}

/** A route with a validated version 1 (and a draft version 2), segments on both, and the "latest" pointers like the API leaves them. */
async function route(options: { archived: boolean; withDraft?: boolean; org?: string }): Promise<World> {
  const org = options.org ?? orgId;
  const creator = org === orgId ? ids.coordinator : ids.otherCoordinator;
  const routeId = randomUUID();
  const validated = randomUUID();
  const draft = options.withDraft === false ? null : randomUUID();
  await owner.query(`INSERT INTO routes (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`, [routeId, org, `Route ${routeId}`, creator]);
  const insert = async (id: string, number: number, status: 'draft' | 'validated') => {
    await owner.query(
      `INSERT INTO route_versions (id, organization_id, route_id, version_number, status, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct, provenance, created_by, validated_by, validated_at)
       VALUES ($1, $2, $3, $4, $5, '${LINE}', 1500, 50, 0, 100, 150, 3.3, 'imported', $6, ${status === 'validated' ? '$6, now()' : 'NULL, NULL'})`,
      [id, org, routeId, number, status, creator],
    );
    await owner.query(`INSERT INTO route_segments (organization_id, version_id, position, geom, road_type, distance_m, ascent_m, descent_m) VALUES ($1, $2, 0, '${LINE}', 'track', 1500, 50, 0)`, [org, id]);
  };
  await insert(validated, 1, 'validated');
  if (draft) await insert(draft, 2, 'draft');
  await owner.query(`UPDATE routes SET latest_version_id = $2, latest_validated_version_id = $3 WHERE id = $1`, [routeId, draft ?? validated, validated]);
  if (options.archived) await owner.query(`UPDATE routes SET status = 'archived' WHERE id = $1`, [routeId]);
  return { route: routeId, validated, draft };
}

/** Puts the pinned version of a route in a mission; works on an archived route because only the API refuses to add one. */
async function pin(missionId: string, world: World, version = world.validated) {
  await owner.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) VALUES ($1, $2, $3, $4, $5)`, [orgId, missionId, world.route, version, ids.coordinator]);
}

/** A route enters a mission while it is open (INV-11); the mission is closed afterwards and keeps the route. */
async function pinThenClose(world: World, version = world.validated) {
  const id = await mission('active');
  await pin(id, world, version);
  await owner.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [id]);
}

/** What the API does, in its order: derivatives first, then the versions (segments follow), then the route; the deferred checks run at the end. */
async function deleteWholeRoute(client: pg.PoolClient, routeId: string) {
  await client.query(`UPDATE routes SET derived_from_route_id = NULL, derived_from_version_id = NULL WHERE derived_from_route_id = $1`, [routeId]);
  await client.query(`DELETE FROM route_versions WHERE route_id = $1`, [routeId]);
  const deleted = await client.query(`DELETE FROM routes WHERE id = $1`, [routeId]);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  return deleted.rowCount;
}

const count = async (client: pg.PoolClient, sql: string, params: unknown[]) => Number((await client.query<{ n: string }>(sql, params)).rows[0]!.n);

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  for (const [id, name] of [
    [orgId, 'Org delete'],
    [otherOrgId, 'Org other'],
  ] as const) {
    await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, $2, 'ES', $3)`, [id, name, `INV-${randomUUID()}`]);
  }
  const members: [string, string, string][] = [
    [ids.admin, orgId, 'admin'],
    [ids.coordinator, orgId, 'coordinator'],
    [ids.rescuer, orgId, 'rescuer'],
    [ids.otherCoordinator, otherOrgId, 'coordinator'],
  ];
  for (const [userId, org, role] of members) {
    await owner.query(`INSERT INTO users (id, email, password_hash, display_name, account_status) VALUES ($1, $2, 'x', $3, 'active')`, [userId, `${role}-${randomUUID()}@example.org`, `Fictitious ${role}`]);
    await owner.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, userId, role]);
  }
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('INV-04: a validated version is deleted only with its archived route that is in no mission (0013)', () => {
  it('migration 0013 is applied and the guard reads other tables, so it runs as its owner', async () => {
    const { rows } = await owner.query<{ prosecdef: boolean }>(`SELECT prosecdef FROM pg_proc WHERE proname = 'route_versions_guard'`);
    expect(rows).toEqual([{ prosecdef: true }]);
  });

  it('refuses to delete the validated version of an ACTIVE route', async () => {
    const world = await route({ archived: false });
    await asApp(as('coordinator'), async (client) => {
      await expect(client.query(`DELETE FROM route_versions WHERE id = $1`, [world.validated])).rejects.toThrow(/INV-04/);
    });
  });

  it('refuses to delete the validated version of an archived route that is in an open mission', async () => {
    for (const status of ['planning', 'active'] as const) {
      const world = await route({ archived: true });
      await pin(await mission(status), world);
      await asApp(as('coordinator'), async (client) => {
        await expect(client.query(`DELETE FROM route_versions WHERE id = $1`, [world.validated])).rejects.toThrow(/INV-04/);
      });
    }
  });

  it('refuses to delete the validated version of an archived route that is in a CLOSED mission', async () => {
    const world = await route({ archived: true });
    await pinThenClose(world);
    await asApp(as('coordinator'), async (client) => {
      await expect(client.query(`DELETE FROM route_versions WHERE id = $1`, [world.validated])).rejects.toThrow(/INV-04/);
    });
  });

  it('still refuses to edit a validated version, even on an archived route that is in no mission', async () => {
    const world = await route({ archived: true });
    await asApp(as('coordinator'), async (client) => {
      await expect(client.query(`UPDATE route_versions SET note = 'x' WHERE id = $1`, [world.validated])).rejects.toThrow(/INV-04/);
    });
  });

  it('deletes the whole archived route that is in no mission: versions, segments and route, validated ones included', async () => {
    const world = await route({ archived: true });
    await asApp(as('coordinator'), async (client) => {
      expect(await deleteWholeRoute(client, world.route)).toBe(1);
      expect(await count(client, `SELECT count(*) AS n FROM route_versions WHERE route_id = $1`, [world.route])).toBe(0);
      expect(await count(client, `SELECT count(*) AS n FROM route_segments WHERE version_id = ANY($1)`, [[world.validated, world.draft]])).toBe(0);
      expect(await count(client, `SELECT count(*) AS n FROM routes WHERE id = $1`, [world.route])).toBe(0);
    });
  });

  it('deletes an archived route with a single validated version and no draft', async () => {
    const world = await route({ archived: true, withDraft: false });
    await asApp(as('coordinator'), async (client) => {
      expect(await deleteWholeRoute(client, world.route)).toBe(1);
    });
  });

  it('the derivatives of a deleted route stay alive and lose only the "derived from" link', async () => {
    const base = await route({ archived: true });
    const child = await route({ archived: false });
    await owner.query(`UPDATE routes SET derived_from_route_id = $2, derived_from_version_id = $3 WHERE id = $1`, [child.route, base.route, base.validated]);
    await asApp(as('coordinator'), async (client) => {
      // Without clearing the link the database refuses: the API clears it first.
      await expect(client.query(`DELETE FROM routes WHERE id = $1`, [base.route])).rejects.toThrow();
    });
    await asApp(as('coordinator'), async (client) => {
      expect(await deleteWholeRoute(client, base.route)).toBe(1);
      const { rows } = await client.query(`SELECT derived_from_route_id, derived_from_version_id FROM routes WHERE id = $1`, [child.route]);
      expect(rows).toEqual([{ derived_from_route_id: null, derived_from_version_id: null }]);
    });
  });

  it('known and accepted (plan D-I3): on an archived route in no mission, SQL could delete one older validated version; the API never does, it deletes the whole route', async () => {
    const world = await route({ archived: true });
    // The deferred "latest" pointers still protect the newest and the latest validated version; one that no pointer names is not protected.
    await owner.query(`UPDATE routes SET latest_validated_version_id = NULL WHERE id = $1`, [world.route]);
    await asApp(as('coordinator'), async (client) => {
      expect((await client.query(`DELETE FROM route_versions WHERE id = $1`, [world.validated])).rowCount).toBe(1);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    const active = await route({ archived: false });
    await owner.query(`UPDATE routes SET latest_validated_version_id = NULL WHERE id = $1`, [active.route]);
    await asApp(as('coordinator'), async (client) => {
      await expect(client.query(`DELETE FROM route_versions WHERE id = $1`, [active.validated])).rejects.toThrow(/INV-04/);
    });
  });

  it('a draft version can still be deleted by itself (unchanged)', async () => {
    const world = await route({ archived: false });
    await asApp(as('coordinator'), async (client) => {
      expect((await client.query(`DELETE FROM route_versions WHERE id = $1`, [world.draft])).rowCount).toBe(1);
    });
  });
});

describe('INV-07: a route that is in any mission, closed ones included, is not deleted (mission_routes.route_id, no cascade)', () => {
  it('refuses to delete the route row while a closed mission keeps it', async () => {
    const world = await route({ archived: true, withDraft: false });
    await pinThenClose(world);
    await asApp(as('coordinator'), async (client) => {
      await expect(client.query(`DELETE FROM routes WHERE id = $1`, [world.route])).rejects.toThrow(/mission_routes|violates foreign key/);
    });
  });

  it('refuses to delete the whole archived route when only a draft is pinned in a closed mission', async () => {
    const world = await route({ archived: true });
    await pinThenClose(world, world.draft!);
    await asApp(as('coordinator'), async (client) => {
      await expect(deleteWholeRoute(client, world.route)).rejects.toThrow(/INV-04|violates foreign key/);
    });
  });

  it('keeps INV-07 on archiving: an active route in a planning or active mission is still not archived', async () => {
    const world = await route({ archived: false });
    await pin(await mission('active'), world);
    await expect(owner.query(`UPDATE routes SET status = 'archived' WHERE id = $1`, [world.route])).rejects.toThrow(/INV-07/);
  });
});

describe('who can delete (policies of 0011, rule 2) and the isolation (INV-01)', () => {
  it('the administrator and the rescuer delete 0 rows', async () => {
    const world = await route({ archived: true });
    for (const role of ['admin', 'rescuer'] as const) {
      await asApp(as(role), async (client) => {
        expect((await client.query(`DELETE FROM route_versions WHERE route_id = $1`, [world.route])).rowCount).toBe(0);
        expect((await client.query(`DELETE FROM routes WHERE id = $1`, [world.route])).rowCount).toBe(0);
      });
    }
  });

  it('a coordinator of another organization finds nothing to delete', async () => {
    const world = await route({ archived: true });
    await asApp({ orgId: otherOrgId, userId: ids.otherCoordinator, role: 'coordinator' }, async (client) => {
      expect((await client.query(`DELETE FROM route_versions WHERE route_id = $1`, [world.route])).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM routes WHERE id = $1`, [world.route])).rowCount).toBe(0);
    });
  });
});
