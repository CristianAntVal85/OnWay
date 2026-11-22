import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDatabase, repoRoot, type TestDatabase } from './fixture.js';

// Migration 0015 (H5-equipos): `teams.code` (INV-23, D-E1), `teams_select` for every role (D-34, INV-01), `memberships.alias` and the
// functions `set_member_alias` and `mission_coordinator_alias` (Q-36, D-E3), through the real `onway_app` login. 0002-0014 are applied
// by hand first so that the backfill of `teams.code` runs over teams that already exist.
let db: TestDatabase;
let owner: pg.Pool;
let app: pg.Pool;

const orgId = randomUUID();
const otherOrg = randomUUID();
const ids = {
  admin: randomUUID(),
  coordinator: randomUUID(),
  other: randomUUID(),
  rescuer: randomUUID(),
  rescuer2: randomUUID(),
  rescuer3: randomUUID(),
  foreign: randomUUID(),
  planning: randomUUID(),
  active: randomUUID(),
  foreignMission: randomUUID(),
};
const legacy: Record<string, string> = {};

type Role = 'admin' | 'coordinator' | 'rescuer';
const as = (role: Role, userId: string, org = orgId) => ({ orgId: org, userId, role });

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

const setAlias = async (client: pg.PoolClient, user: string, base: string | null, code: string | null) =>
  (await client.query<{ alias: string | null }>('SELECT set_member_alias($1, $2, $3) AS alias', [user, base, code])).rows[0]!.alias;
const aliasOf = async (user: string) => (await owner.query<{ alias: string | null }>('SELECT alias FROM memberships WHERE user_id = $1', [user])).rows[0]!.alias;

async function addUser(id: string, org: string, role: Role, alias: string | null = null) {
  await owner.query(`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'x', $3)`, [id, `${role}-${randomUUID()}@example.org`, `Fictitious ${role}`]);
  await owner.query(`INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'active')`, [org, id, role]);
  if (alias) await owner.query(`UPDATE memberships SET alias = $2 WHERE user_id = $1`, [id, alias]);
}

beforeAll(async () => {
  db = await startDatabase();
  owner = new pg.Pool({ ...db.owner, max: 2 });
  app = new pg.Pool({ ...db.app, max: 2 });

  const dir = join(repoRoot, 'db', 'migrations');
  const files = (await readdir(dir)).filter((f) => /^00(0[2-9]|1[0-4])_.*\.sql$/.test(f)).sort();
  for (const f of files) await owner.query(await readFile(join(dir, f), 'utf8'));

  // Teams that exist before 0015 (no `code` column yet).
  await owner.query(`INSERT INTO organizations (id, name, country, invite_code) VALUES ($1, 'Org alias', 'ES', $2), ($3, 'Other org', 'ES', $4)`, [orgId, `INV-${randomUUID()}`, otherOrg, `INV-${randomUUID()}`]);
  const legacyTeam = async (org: string, name: string, locality: string) => {
    const { rows } = await owner.query<{ id: string }>(`INSERT INTO teams (organization_id, name, locality) VALUES ($1, $2, $3) RETURNING id`, [org, name, locality]);
    return rows[0]!.id;
  };
  legacy.alicante1 = await legacyTeam(orgId, 'Legacy Alicante 1', 'Alicante');
  legacy.alicante2 = await legacyTeam(orgId, 'Legacy Alicante 2', 'Alicante');
  legacy.alicante3 = await legacyTeam(orgId, 'Legacy Alicante 3', 'Alicante');
  legacy.sabi = await legacyTeam(orgId, 'Legacy Sabiñánigo', 'Sabiñánigo');
  legacy.jaca = await legacyTeam(orgId, 'Legacy Jaca', 'Jaca');
  legacy.nandu = await legacyTeam(orgId, 'Legacy Ñandú', 'Ñandú');
  legacy.empty = await legacyTeam(orgId, 'Legacy sin letras', '123');
  legacy.foreign = await legacyTeam(otherOrg, 'Legacy Alicante 1', 'Alicante');

  await owner.query(await readFile(join(dir, '0015_teams_code_alias.sql'), 'utf8'));

  await addUser(ids.admin, orgId, 'admin', 'admin');
  await addUser(ids.coordinator, orgId, 'coordinator', 'coord');
  await addUser(ids.other, orgId, 'coordinator');
  await addUser(ids.rescuer, orgId, 'rescuer');
  await addUser(ids.rescuer2, orgId, 'rescuer');
  await addUser(ids.rescuer3, orgId, 'rescuer');
  await addUser(ids.foreign, otherOrg, 'coordinator', 'coord');
  const mission = (id: string, org: string, status: string, coordinator: string) =>
    owner.query(
      `INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at) VALUES ($1, $2, $3, $4, $5, 'POINT Z (0 0 0)', 'map', $4, ${status === 'planning' ? 'NULL' : 'now()'})`,
      [id, org, `Mission ${id}`, coordinator, status],
    );
  await mission(ids.planning, orgId, 'planning', ids.coordinator);
  await mission(ids.active, orgId, 'active', ids.coordinator);
  await mission(ids.foreignMission, otherOrg, 'active', ids.foreign);
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
  await db?.stop();
});

describe('teams.code (INV-23, 0015)', () => {
  it('fills the teams that already existed with the rule of the web and solves clashes with a digit', async () => {
    const { rows } = await owner.query<{ id: string; code: string }>('SELECT id, code FROM teams');
    const code = (key: string) => rows.find((r) => r.id === legacy[key])!.code;
    expect(code('alicante1')).toBe('ALC');
    expect(code('alicante2')).toBe('AL2');
    expect(code('alicante3')).toBe('AL3');
    expect(code('sabi')).toBe('SBN');
    expect(code('jaca')).toBe('JCA');
    expect(code('nandu')).toBe('NND');
    expect(code('empty')).toBe('XXX');
    expect(code('foreign')).toBe('ALC'); // unique per organization, not global
  });

  it('the code is mandatory, three characters in capitals, and unique in the organization', async () => {
    const insert = (code: string | null, name = `T ${randomUUID()}`, org = orgId) =>
      owner.query(`INSERT INTO teams (organization_id, name, locality, code) VALUES ($1, $2, 'Loc', $3)`, [org, name, code]);
    await expect(insert(null)).rejects.toThrow(/null value/);
    for (const bad of ['AB', 'ABCD', 'abc', 'A-C']) await expect(insert(bad)).rejects.toThrow(/teams_code_chk/);
    await expect(insert('ALC')).rejects.toThrow(/teams_org_code_uq/);
    await expect(insert('ZZ1', undefined, otherOrg)).resolves.toBeDefined();
    await expect(insert('ALC', undefined, otherOrg)).rejects.toThrow(/teams_org_code_uq/);
  });

  it('INV-23: a team has a locality and a name that is unique in the organization without case', async () => {
    await expect(owner.query(`INSERT INTO teams (organization_id, name, locality, code) VALUES ($1, 'Blank', ' ', 'BLK')`, [orgId])).rejects.toThrow(/locality/);
    await expect(owner.query(`INSERT INTO teams (organization_id, name, locality, code) VALUES ($1, 'LEGACY JACA', 'Jaca', 'JC9')`, [orgId])).rejects.toThrow(/teams_org_name_uq/);
  });
});

describe('teams_select for every role (D-34, INV-01)', () => {
  it('a rescuer reads all the teams of the organization and none of another', async () => {
    await asApp(as('rescuer', ids.rescuer), async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM teams');
      expect(rows.map((r) => r.id)).toContain(legacy.alicante1);
      expect(rows.map((r) => r.id)).not.toContain(legacy.foreign);
      expect(rows.length).toBe(7);
    });
    await asApp(as('coordinator', ids.coordinator), async (client) => {
      expect((await client.query('SELECT id FROM teams WHERE id = $1', [legacy.foreign])).rowCount).toBe(0);
    });
  });

  it('a rescuer still reads no team_members of others and writes no team', async () => {
    await owner.query(`INSERT INTO team_members (team_id, user_id, organization_id) VALUES ($1, $2, $4), ($1, $3, $4)`, [legacy.sabi, ids.rescuer2, ids.rescuer3, orgId]);
    try {
      await asApp(as('rescuer', ids.rescuer), async (client) => {
        expect((await client.query('SELECT 1 FROM team_members')).rowCount).toBe(0);
      });
      await asApp(as('rescuer', ids.rescuer2), async (client) => {
        const { rows } = await client.query<{ user_id: string }>('SELECT user_id FROM team_members');
        expect(rows.map((r) => r.user_id)).toEqual([ids.rescuer2]);
        expect((await client.query(`UPDATE teams SET name = 'Hacked' WHERE id = $1`, [legacy.sabi])).rowCount).toBe(0);
        await expect(client.query(`INSERT INTO teams (organization_id, name, locality, code) VALUES ($1, 'Mine', 'Loc', 'MIN')`, [orgId])).rejects.toThrow(/row-level security/);
      });
    } finally {
      await owner.query('DELETE FROM team_members WHERE team_id = $1', [legacy.sabi]);
    }
  });
});

describe('memberships.alias (Q-36, D-E1)', () => {
  it('is unique in the organization without distinguishing case, and its format is checked', async () => {
    await expect(owner.query(`UPDATE memberships SET alias = 'coord' WHERE user_id = $1`, [ids.other])).rejects.toThrow(/memberships_org_alias_uq/);
    await expect(owner.query(`UPDATE memberships SET alias = 'COORD' WHERE user_id = $1`, [ids.other])).rejects.toThrow(/memberships_alias_check/);
    await expect(owner.query(`UPDATE memberships SET alias = 'coord' WHERE user_id = $1`, [ids.foreign])).resolves.toBeDefined(); // another organization
    await expect(owner.query(`UPDATE memberships SET alias = 'Bad Alias' WHERE user_id = $1`, [ids.other])).rejects.toThrow(/memberships_alias_check/);
  });

  it('the application cannot write the alias, but the administrator still changes a role (INV-29)', async () => {
    for (const [role, user] of [['admin', ids.admin], ['coordinator', ids.coordinator], ['rescuer', ids.rescuer]] as const) {
      await asApp(as(role, user), async (client) => {
        await expect(client.query(`UPDATE memberships SET alias = 'mine' WHERE user_id = $1`, [user])).rejects.toThrow(/permission denied/);
      });
    }
    await asApp(as('admin', ids.admin), async (client) => {
      expect((await client.query(`UPDATE memberships SET role = 'coordinator' WHERE user_id = $1`, [ids.rescuer3])).rowCount).toBe(1);
      await expect(client.query(`UPDATE memberships SET status = 'disabled' WHERE user_id = $1`, [ids.rescuer3])).rejects.toThrow(/permission denied/);
    });
  });
});

describe('set_member_alias (0015)', () => {
  it('sets the base for the person or for the staff, adds a numeric suffix on a clash and the code after it', async () => {
    await asApp(as('rescuer', ids.rescuer), async (client) => {
      expect(await setAlias(client, ids.rescuer, 'criantval', null)).toBe('criantval');
    });
    await asApp(as('coordinator', ids.coordinator), async (client) => {
      expect(await setAlias(client, ids.rescuer, 'criantval', null)).toBe('criantval');
      expect(await setAlias(client, ids.rescuer2, 'criantval', null)).toBe('criantval2');
      expect(await setAlias(client, ids.rescuer3, 'criantval', null)).toBe('criantval3');
      // The code is the first thing after the base: three people with the same name and the same team.
      expect(await setAlias(client, ids.rescuer, null, 'ALC')).toBe('criantval ALC');
      expect(await setAlias(client, ids.rescuer2, null, 'ALC')).toBe('criantval2 ALC');
      expect(await setAlias(client, ids.rescuer3, null, 'ALC')).toBe('criantval3 ALC');
    });
    await asApp(as('coordinator', ids.coordinator), async (client) => {
      expect(await setAlias(client, ids.rescuer, 'criantval', 'ALC')).toBe('criantval ALC'); // no alias yet (rolled back): base and code together
      expect(await setAlias(client, ids.rescuer2, 'criantval', 'ALC')).toBe('criantval2 ALC');
    });
  });

  it('the code is added once, and from then on the alias is fixed', async () => {
    await owner.query(`UPDATE memberships SET alias = 'marsan' WHERE user_id = $1`, [ids.rescuer]);
    try {
      await asApp(as('coordinator', ids.coordinator), async (client) => {
        expect(await setAlias(client, ids.rescuer, 'otra', 'BSC')).toBe('marsan BSC');
        expect(await setAlias(client, ids.rescuer, 'otra', 'BNS')).toBe('marsan BSC');
        expect(await setAlias(client, ids.rescuer, null, null)).toBe('marsan BSC');
        expect((await client.query(`SELECT alias FROM memberships WHERE user_id = $1`, [ids.rescuer])).rows[0].alias).toBe('marsan BSC');
      });
      // With no code the alias stays as it is, whatever the base.
      await asApp(as('rescuer', ids.rescuer), async (client) => {
        expect(await setAlias(client, ids.rescuer, 'zzz', null)).toBe('marsan');
      });
    } finally {
      await owner.query(`UPDATE memberships SET alias = NULL WHERE user_id = $1`, [ids.rescuer]);
    }
  });

  it('a clash on the code step puts the numeric suffix before the code', async () => {
    await owner.query(`UPDATE memberships SET alias = 'marsan ALC' WHERE user_id = $1`, [ids.rescuer]);
    await owner.query(`UPDATE memberships SET alias = 'marsan' WHERE user_id = $1`, [ids.rescuer2]);
    try {
      await asApp(as('admin', ids.admin), async (client) => {
        expect(await setAlias(client, ids.rescuer2, null, 'ALC')).toBe('marsan2 ALC');
      });
      await asApp(as('admin', ids.admin), async (client) => {
        expect(await setAlias(client, ids.rescuer2, null, 'BSC')).toBe('marsan BSC');
      });
    } finally {
      await owner.query(`UPDATE memberships SET alias = NULL WHERE user_id = ANY($1)`, [[ids.rescuer, ids.rescuer2]]);
    }
  });

  it('without an alias and without a base it returns null and changes nothing', async () => {
    await asApp(as('coordinator', ids.coordinator), async (client) => {
      expect(await setAlias(client, ids.rescuer, null, 'ALC')).toBeNull();
      expect((await client.query(`SELECT alias FROM memberships WHERE user_id = $1`, [ids.rescuer])).rows[0].alias).toBeNull();
    });
  });

  it('only the person or the staff of the organization call it, and the person must belong to it', async () => {
    await asApp(as('rescuer', ids.rescuer), async (client) => {
      await expect(setAlias(client, ids.rescuer2, 'abc', null)).rejects.toThrow(/propia persona o el personal/);
    });
    for (const user of [ids.foreign, randomUUID()]) {
      await asApp(as('coordinator', ids.coordinator), async (client) => {
        await expect(setAlias(client, user, 'abc', null)).rejects.toThrow(/no encontrado/);
      });
    }
    await asApp({ orgId: '', userId: '', role: 'rescuer' }, async (client) => {
      await expect(setAlias(client, ids.rescuer, 'abc', null)).rejects.toThrow(/Sin contexto/);
    });
    expect(await aliasOf(ids.foreign)).toBe('coord');
  });

  it('rejects a base or a code that does not have the format', async () => {
    await asApp(as('coordinator', ids.coordinator), async (client) => {
      await expect(setAlias(client, ids.rescuer, 'Bad Base', null)).rejects.toThrow(/Base de alias/);
    });
    await asApp(as('coordinator', ids.coordinator), async (client) => {
      await expect(setAlias(client, ids.rescuer, 'abc', 'alc')).rejects.toThrow(/Código de localidad/);
    });
  });

  it('is not callable by PUBLIC: only onway_app has EXECUTE', async () => {
    const { rows } = await owner.query<{ grantee: string }>(
      `SELECT DISTINCT grantee FROM information_schema.routine_privileges WHERE routine_name IN ('set_member_alias', 'mission_coordinator_alias') AND grantee NOT IN ('onway_owner')`,
    );
    expect(rows.map((r) => r.grantee).sort()).toEqual(['onway_app']);
  });
});

describe('mission_coordinator_alias (0015, D-E3, RN-16)', () => {
  const alias = async (client: pg.PoolClient, mission: string) =>
    (await client.query<{ a: string | null }>('SELECT mission_coordinator_alias($1) AS a', [mission])).rows[0]!.a;

  it('the staff reads the alias of any mission of the organization', async () => {
    await asApp(as('coordinator', ids.other), async (client) => {
      expect(await alias(client, ids.planning)).toBe('coord');
      expect(await alias(client, ids.active)).toBe('coord');
    });
  });

  it('a rescuer reads it for an active or closed mission and not for one in planning', async () => {
    await asApp(as('rescuer', ids.rescuer), async (client) => {
      expect(await alias(client, ids.active)).toBe('coord');
      expect(await alias(client, ids.planning)).toBeNull();
    });
    await owner.query(`UPDATE missions SET status = 'closed', closed_at = now() WHERE id = $1`, [ids.active]);
    try {
      await asApp(as('rescuer', ids.rescuer), async (client) => {
        expect(await alias(client, ids.active)).toBe('coord');
      });
    } finally {
      await owner.query(`UPDATE missions SET status = 'active', closed_at = NULL WHERE id = $1`, [ids.active]);
    }
  });

  it('another organization and an unknown mission answer null, and a rescuer cannot read memberships through it', async () => {
    await asApp(as('rescuer', ids.rescuer), async (client) => {
      expect(await alias(client, ids.foreignMission)).toBeNull();
      expect(await alias(client, randomUUID())).toBeNull();
      expect((await client.query(`SELECT 1 FROM memberships WHERE user_id = $1`, [ids.coordinator])).rowCount).toBe(0);
    });
    await asApp(as('coordinator', ids.coordinator, otherOrg), async (client) => {
      expect(await alias(client, ids.active)).toBeNull();
    });
  });
});
