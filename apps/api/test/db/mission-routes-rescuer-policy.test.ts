import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { startDatabase, type TestDatabase } from './fixture.js';

// H4-T3, INV-05 and RN-03 in the database itself: through the real `onway_app` login with the role of a rescuer, the policies
// `mroutes_rescuer`, `versions_rescuer`, `segments_rescuer` and `routes_rescuer` show only what the API shows: the PINNED version, if
// validated, of a route in a mission the rescuer can see (never planning). If one of these lets something else through, STOP and ask.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const otherOrgId = randomUUID();
const ids = { admin: randomUUID(), coordinator: randomUUID(), rescuer: randomUUID(), otherRescuer: randomUUID(), otherCoordinator: randomUUID() };
const LINE = 'LINESTRING Z (0 0 100, 0.01 0.01 150)';

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

async function mission(status: 'planning' | 'active' | 'closed', org = orgId): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at, closed_at)
     VALUES ($1, $2, $3, $4, $5, 'POINT Z (0 0 0)', 'map', $4, ${status === 'planning' ? 'NULL' : 'now()'}, ${status === 'closed' ? 'now()' : 'NULL'})`,
    [id, org, `Mission ${randomUUID()}`, org === orgId ? ids.coordinator : ids.otherCoordinator, status],
  );
  return id;
}
async function route(name: string, org = orgId): Promise<string> {
  const id = randomUUID();
  await owner.query(`INSERT INTO routes (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`, [id, org, name, ids.coordinator]);
  return id;
}
async function version(routeId: string, number: number, status: 'draft' | 'validated', org = orgId): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO route_versions (id, organization_id, route_id, version_number, status, geom, distance_m, ascent_m, descent_m, min_elevation_m, max_elevation_m, max_slope_pct, provenance, created_by, validated_by, validated_at)
     VALUES ($1, $2, $3, $4, $5, '${LINE}', 1500, 50, 0, 100, 150, 3.3, 'imported', $6, ${status === 'validated' ? '$6, now()' : 'NULL, NULL'})`,
    [id, org, routeId, number, status, ids.coordinator],
  );
  await owner.query(
    `INSERT INTO route_segments (organization_id, version_id, position, geom, road_type, distance_m, ascent_m, descent_m) VALUES ($1, $2, 0, '${LINE}', 'track', 1500, 50, 0)`,
    [org, id],
  );
  return id;
}
async function pin(missionId: string, routeId: string, versionId: string, status: 'added' | 'unavailable' = 'added', org = orgId): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, status, added_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [org, missionId, routeId, versionId, status, ids.coordinator],
  );
  return rows[0]!.id;
}

// What the world looks like: one row per case, named by what must happen to it.
const row: Record<string, string> = {};
const ver: Record<string, string> = {};
const rt: Record<string, string> = {};

beforeAll(async () => {
  db = await startDatabase();
  await runMigrations(db.owner);
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  for (const [id, name] of [[orgId, 'Org H4'], [otherOrgId, 'Org H4 other']] as const) {
    await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, $2, 'ES', $3)`, [id, name, `INV-${randomUUID()}`]);
  }
  for (const [key, role, org] of [['admin', 'admin', orgId], ['coordinator', 'coordinator', orgId], ['rescuer', 'rescuer', orgId], ['otherRescuer', 'rescuer', otherOrgId], ['otherCoordinator', 'coordinator', otherOrgId]] as const) {
    await owner.query(`INSERT INTO users (id, email, password_hash, display_name, account_status) VALUES ($1, $2, 'x', $3, 'active')`, [ids[key], `${key}-${randomUUID()}@example.org`, `Fictitious ${key}`]);
    await owner.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, ids[key], role]);
  }

  const active = await mission('active');
  const closed = await mission('active'); // closed below: INV-11 refuses rows in a closed mission, so the route is pinned while it is open
  const planning = await mission('planning');

  // visible: a validated pinned version in an active mission
  rt.visible = await route('Visible');
  ver.visible = await version(rt.visible, 1, 'validated');
  row.visible = await pin(active, rt.visible, ver.visible);
  // visible and marked: unavailable is shown, not hidden (RF-508)
  rt.unavailable = await route('Unavailable');
  ver.unavailable = await version(rt.unavailable, 1, 'validated');
  row.unavailable = await pin(active, rt.unavailable, ver.unavailable, 'unavailable');
  // the pinned version is validated, the route has a newer validated one that is NOT pinned: only the pinned one is shown
  rt.moved = await route('Moved');
  ver.pinnedOld = await version(rt.moved, 1, 'validated');
  ver.newerNotPinned = await version(rt.moved, 2, 'validated');
  row.moved = await pin(active, rt.moved, ver.pinnedOld);
  // hidden: the pinned version is a Draft, even if the route has a validated one
  rt.draftPinned = await route('Draft pinned');
  ver.draft = await version(rt.draftPinned, 1, 'draft');
  ver.validatedNotPinned = await version(rt.draftPinned, 2, 'validated');
  row.draftPinned = await pin(active, rt.draftPinned, ver.draft);
  // hidden: the mission is in planning (RN-16)
  rt.planning = await route('In planning');
  ver.planning = await version(rt.planning, 1, 'validated');
  row.planning = await pin(planning, rt.planning, ver.planning);
  // visible: a closed mission is read
  rt.closed = await route('In closed');
  ver.closed = await version(rt.closed, 1, 'validated');
  row.closed = await pin(closed, rt.closed, ver.closed);
  await owner.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [closed]);
  // hidden: another organization
  const foreignMission = await mission('active', otherOrgId);
  rt.foreign = await route('Foreign', otherOrgId);
  ver.foreign = await version(rt.foreign, 1, 'validated', otherOrgId);
  row.foreign = await pin(foreignMission, rt.foreign, ver.foreign, 'added', otherOrgId);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

const ofIds = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const sorted = (...values: string[]) => [...values].sort();

describe('the rescuer reads only what INV-05 allows (mroutes_rescuer, versions_rescuer, segments_rescuer, routes_rescuer)', () => {
  it('mission_routes: validated pinned rows of active and closed missions, the unavailable one included; not Draft, not planning, not another organization', async () => {
    await asApp(as('rescuer'), async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM mission_routes`);
      expect(ofIds(rows)).toEqual(sorted(row.visible!, row.unavailable!, row.moved!, row.closed!));
    });
  });

  it('route_versions: the pinned validated versions only; not the newer validated one that nobody pinned, not Drafts', async () => {
    await asApp(as('rescuer'), async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM route_versions`);
      expect(ofIds(rows)).toEqual(sorted(ver.visible!, ver.unavailable!, ver.pinnedOld!, ver.closed!));
      for (const hidden of [ver.newerNotPinned, ver.draft, ver.validatedNotPinned, ver.planning, ver.foreign]) expect(rows.map((r) => r.id)).not.toContain(hidden);
    });
  });

  it('route_segments: those of the visible versions, none of the hidden ones', async () => {
    await asApp(as('rescuer'), async (client) => {
      const { rows } = await client.query<{ version_id: string }>(`SELECT version_id FROM route_segments`);
      expect(rows.map((r) => r.version_id).sort()).toEqual(sorted(ver.visible!, ver.unavailable!, ver.pinnedOld!, ver.closed!));
    });
  });

  it('routes: those used by a visible row; the route of a Draft pinned version or of a mission in planning is not there', async () => {
    await asApp(as('rescuer'), async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM routes`);
      expect(ofIds(rows)).toEqual(sorted(rt.visible!, rt.unavailable!, rt.moved!, rt.closed!));
    });
  });

  it('the geometry of a hidden version cannot be read by id either', async () => {
    await asApp(as('rescuer'), async (client) => {
      for (const hidden of [ver.draft!, ver.newerNotPinned!, ver.planning!, ver.foreign!]) {
        const { rows } = await client.query(`SELECT ST_AsText(geom) FROM route_versions WHERE id = $1`, [hidden]);
        expect(rows).toEqual([]);
      }
    });
  });

  it('the rescuer of another organization sees none of this organization', async () => {
    await asApp({ orgId: otherOrgId, userId: ids.otherRescuer, role: 'rescuer' }, async (client) => {
      const { rows } = await client.query<{ id: string }>(`SELECT id FROM mission_routes`);
      expect(ofIds(rows)).toEqual([row.foreign!]);
    });
  });

  it('the staff keep reading everything of their organization (Drafts and planning included), so the difference is the role', async () => {
    for (const role of ['coordinator', 'admin'] as const) {
      await asApp(as(role), async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM mission_routes`);
        expect(ofIds(rows)).toEqual(sorted(row.visible!, row.unavailable!, row.moved!, row.draftPinned!, row.planning!, row.closed!));
      });
    }
  });
});

describe('the rescuer writes nothing in missions or routes (rule 2)', () => {
  it('cannot insert a mission route', async () => {
    await asApp(as('rescuer'), async (client) => {
      await expect(
        client.query(`INSERT INTO mission_routes (organization_id, mission_id, route_id, pinned_version_id, added_by) SELECT organization_id, mission_id, route_id, pinned_version_id, $1 FROM mission_routes LIMIT 1`, [ids.rescuer]),
      ).rejects.toThrow(/row-level security|permission denied/);
    });
  });

  it('cannot change or delete a mission route, nor change a version', async () => {
    await asApp(as('rescuer'), async (client) => {
      expect((await client.query(`UPDATE mission_routes SET status = 'unavailable'`)).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM mission_routes`)).rowCount).toBe(0);
      expect((await client.query(`UPDATE route_versions SET status = 'draft'`)).rowCount).toBe(0);
    });
  });
});
