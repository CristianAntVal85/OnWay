import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { DatabaseService } from '../../src/db/database.service.js';
import { memberships, rescuerProfiles, teamMembers, teams, users } from '../../src/db/schema.js';
import { Fixtures } from '../support/fixtures.js';

let db: DatabaseService;
let fixtures: Fixtures;
let a: Awaited<ReturnType<Fixtures['fullOrganization']>>;
let b: Awaited<ReturnType<Fixtures['fullOrganization']>>;

beforeAll(async () => {
  const { owner, app } = inject('database');
  fixtures = new Fixtures(owner);
  db = new DatabaseService(app);
  await db.onModuleInit();
  a = await fixtures.fullOrganization('A');
  b = await fixtures.fullOrganization('B');
});

afterAll(async () => {
  await db?.onModuleDestroy();
  await fixtures?.close();
});

const ctx = (org: { orgId: string }, member: { userId: string; role: 'admin' | 'coordinator' | 'rescuer' }) => ({ orgId: org.orgId, userId: member.userId, role: member.role });

describe('the API role (rule 1, doc 05 §6.2)', () => {
  it('starts as onway_app', async () => {
    const [row] = (await db.withAnonymous((tx) => tx.execute<{ me: string }>(`SELECT current_user AS me` as never))).rows;
    expect(row?.me).toBe('onway_app');
  });

  it('refuses to start as the schema owner, which would skip row level security', async () => {
    const owner = new DatabaseService(inject('database').owner);
    await expect(owner.onModuleInit()).rejects.toThrow(/skips row level security/);
    await owner.onModuleDestroy();
  });
});

describe('transaction context (D-H0-02, doc 05 §6.1)', () => {
  it('fixes the three settings for the transaction and nothing leaks to the next one', async () => {
    const inside = await db.withContext(
      ctx(a, a.coordinator),
      async (tx) => (await tx.execute<{ o: string; u: string; r: string }>(`SELECT current_setting('app.org_id') o, current_setting('app.user_id') u, current_setting('app.role') r` as never)).rows[0],
    );
    expect(inside).toEqual({ o: a.orgId, u: a.coordinator.userId, r: 'coordinator' });

    const after = await db.withAnonymous(async (tx) => (await tx.execute<{ o: string | null }>(`SELECT nullif(current_setting('app.org_id', true), '') o` as never)).rows[0]);
    expect(after?.o).toBeNull();
  });

  it('exposes the transaction through current() only inside withContext or withAnonymous', async () => {
    expect(() => db.current()).toThrow(/no database transaction in progress/);
    await db.withContext(ctx(a, a.admin), async (tx) => {
      expect(db.current()).toBe(tx);
    });
    expect(() => db.current()).toThrow(/no database transaction in progress/);
  });

  it('does not nest transactions', async () => {
    await expect(db.withContext(ctx(a, a.admin), () => db.withAnonymous(async () => 1))).rejects.toThrow(/already in progress/);
  });

  it('rejects a malformed context before touching the database', async () => {
    await expect(db.withContext({ orgId: "x'; DROP TABLE users; --", userId: a.admin.userId, role: 'admin' }, async () => 1)).rejects.toThrow(/invalid database context/);
    await expect(db.withContext({ orgId: a.orgId, userId: a.admin.userId, role: 'platform' as never }, async () => 1)).rejects.toThrow(/invalid database context/);
  });

  it('rolls back when the handler fails', async () => {
    const name = `Rolled back ${Date.now()}`;
    await expect(
      db.withContext(ctx(a, a.coordinator), async (tx) => {
        await tx.insert(teams).values({ organizationId: a.orgId, name, locality: 'Nowhere' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await fixtures.query(`SELECT 1 FROM teams WHERE name = $1`, [name])).toEqual([]);
  });

  it('keeps concurrent requests apart: each one sees only its own organization', async () => {
    const jobs = Array.from({ length: 24 }, (_, i) => {
      const org = i % 2 === 0 ? a : b;
      return db.withContext(ctx(org, org.coordinator), async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
        const rows = await db.current().select({ orgId: memberships.organizationId }).from(memberships);
        expect(db.current()).toBe(tx);
        return { expected: org.orgId, orgs: [...new Set(rows.map((r) => r.orgId))] };
      });
    });
    for (const result of await Promise.all(jobs)) expect(result.orgs).toEqual([result.expected]);
  });
});

describe('INV-01 through the API connection', () => {
  const userIdsOfA = () => [a.admin.userId, a.coordinator.userId, a.rescuer.userId];

  it('with no context nothing is visible', async () => {
    const counts = await db.withAnonymous(async (tx) => ({
      memberships: (await tx.select().from(memberships)).length,
      users: (await tx.select().from(users)).length,
      teams: (await tx.select().from(teams)).length,
      teamMembers: (await tx.select().from(teamMembers)).length,
      rescuerProfiles: (await tx.select().from(rescuerProfiles)).length,
    }));
    expect(counts).toEqual({ memberships: 0, users: 0, teams: 0, teamMembers: 0, rescuerProfiles: 0 });
  });

  it('inside B, the rows of A are invisible in memberships, users, teams, team_members and rescuer_profiles', async () => {
    const seen = await db.withContext(ctx(b, b.admin), async (tx) => ({
      memberships: (await tx.select().from(memberships).where(eq(memberships.organizationId, a.orgId))).length,
      users: (await tx.select().from(users).where(inArray(users.id, userIdsOfA()))).length,
      teams: (await tx.select().from(teams).where(eq(teams.organizationId, a.orgId))).length,
      teamMembers: (await tx.select().from(teamMembers).where(eq(teamMembers.organizationId, a.orgId))).length,
      rescuerProfiles: (await tx.select().from(rescuerProfiles).where(eq(rescuerProfiles.organizationId, a.orgId))).length,
      own: (await tx.select().from(memberships)).length,
    }));
    expect(seen).toEqual({ memberships: 0, users: 0, teams: 0, teamMembers: 0, rescuerProfiles: 0, own: 3 });
  });

  it('inside B, writing a row with the organization of A fails', async () => {
    await expect(db.withContext(ctx(b, b.coordinator), (tx) => tx.insert(teams).values({ organizationId: a.orgId, name: 'Intruder', locality: 'X' }))).rejects.toThrow();
    expect(await fixtures.query(`SELECT 1 FROM teams WHERE name = 'Intruder'`)).toEqual([]);
  });

  it('inside B, updating a team of A changes nothing', async () => {
    const updated = await db.withContext(ctx(b, b.coordinator), (tx) => tx.update(teams).set({ locality: 'Hijacked' }).where(eq(teams.id, a.teamId)).returning({ id: teams.id }));
    expect(updated).toEqual([]);
    expect((await fixtures.query<{ locality: string }>(`SELECT locality FROM teams WHERE id = $1`, [a.teamId]))[0]?.locality).toBe('Locality');
  });
});
