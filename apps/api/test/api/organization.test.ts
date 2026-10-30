import { ERROR_HTTP, ErrorResponse, MAX_FILE_BYTES, MeResponse, OrgInfo } from '@onway/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DatabaseService } from '../../src/db/database.service.js';
import { memberships, organizations, rescuerProfiles, teamMembers, teams, users } from '../../src/db/schema.js';
import { mustLogin, startApp, withSession, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// Two organizations in the container. B exists only here: the demo has one (D-08, D-H0-18), and the fixture
// creates B as onway_owner, the way the platform would.
let app: TestApp;
let fixtures: Fixtures;
let database: DatabaseService;

interface Org {
  orgId: string;
  name: string;
  inviteCode: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
  teamId: string;
}

let a: Org;
let b: Org;
let pending: Member;

async function build(label: string, validationMaxAgeDays: number): Promise<Org> {
  const orgId = await fixtures.organization(label);
  await fixtures.query(`UPDATE organizations SET validation_max_age_days = $2 WHERE id = $1`, [orgId, validationMaxAgeDays]);
  const options = { password: TEST_PASSWORD };
  const admin = await fixtures.member(orgId, 'admin', 'active', options);
  const coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
  const rescuer = await fixtures.member(orgId, 'rescuer', 'active', options);
  const teamId = await fixtures.team(orgId);
  await fixtures.addToTeam(teamId, rescuer);
  const [row] = await fixtures.query<{ name: string; invite_code: string }>(`SELECT name, invite_code FROM organizations WHERE id = $1`, [orgId]);
  return { orgId, name: row!.name, inviteCode: row!.invite_code, admin, coordinator, rescuer, teamId };
}

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection });
  database = app.app.get(DatabaseService);
  a = await build('Org A', 90);
  b = await build('Org B', 45);
  pending = await fixtures.applicant(a.orgId, 'pending', { password: TEST_PASSWORD });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const getOrganization = (session: Awaited<ReturnType<typeof mustLogin>>) => fetch(`${app.baseUrl}/org`, { headers: withSession(session, false) });
const ctx = (org: Org, member: Member) => ({ orgId: org.orgId, userId: member.userId, role: member.role });

describe('getOrganization (RF-102)', () => {
  it.each(['admin', 'coordinator', 'rescuer'] as const)('the %s gets their own organization, valid against OrgInfo', async (role) => {
    const session = await mustLogin(app, a[role].email, TEST_PASSWORD);
    const response = await getOrganization(session);
    expect(response.status).toBe(200);
    expect(OrgInfo.parse(await response.json())).toEqual({
      id: a.orgId,
      name: a.name,
      country: 'ES',
      config: { validationMaxAgeDays: 90, maxUploadBytes: MAX_FILE_BYTES },
    });
  });

  it('never includes the invitation code, nor anything the contract does not declare', async () => {
    const session = await mustLogin(app, a.admin.email, TEST_PASSWORD);
    const text = await (await getOrganization(session)).text();
    expect(text).not.toContain(a.inviteCode);
    expect(text).not.toMatch(/invite|status|rotated|created/i);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['config', 'country', 'id', 'name']);
  });

  it('without a session it answers 401 UNAUTHENTICATED', async () => {
    const response = await fetch(`${app.baseUrl}/org`);
    expect(response.status).toBe(ERROR_HTTP.UNAUTHENTICATED);
    expect(ErrorResponse.parse(await response.json()).error.code).toBe('UNAUTHENTICATED');
  });
});

describe('INV-01 through the API', () => {
  it.each(['admin', 'coordinator', 'rescuer'] as const)('the session of B (%s) receives only organization B in getOrganization and getMe', async (role) => {
    const session = await mustLogin(app, b[role].email, TEST_PASSWORD);

    const org = OrgInfo.parse(await (await getOrganization(session)).json());
    expect(org).toEqual({ id: b.orgId, name: b.name, country: 'ES', config: { validationMaxAgeDays: 45, maxUploadBytes: MAX_FILE_BYTES } });
    expect(JSON.stringify(org)).not.toContain(a.orgId);

    const me = MeResponse.parse(await (await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) })).json());
    expect(me.user.organization).toEqual({ id: b.orgId, name: b.name });
    expect(me.user.role).toBe(role);
  });

  it('two sessions at the same time each see their own organization', async () => {
    const [sa, sb] = await Promise.all([mustLogin(app, a.coordinator.email, TEST_PASSWORD), mustLogin(app, b.coordinator.email, TEST_PASSWORD)]);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => getOrganization(i % 2 === 0 ? sa : sb).then((r) => r.json() as Promise<{ id: string }>)));
    results.forEach((org, i) => expect(org.id).toBe(i % 2 === 0 ? a.orgId : b.orgId));
  });
});

describe('INV-01 in the real context of B (connection onway_app)', () => {
  it('memberships, users, teams, team_members and rescuer_profiles of A return zero rows', async () => {
    const userIdsOfA = [a.admin.userId, a.coordinator.userId, a.rescuer.userId, pending.userId];
    const seen = await database.withContext(ctx(b, b.admin), async (tx) => {
      const allUsers = await tx.select({ id: users.id }).from(users);
      return {
        memberships: (await tx.select().from(memberships).where(eq(memberships.organizationId, a.orgId))).length,
        usersOfA: allUsers.filter((u) => userIdsOfA.includes(u.id)).length,
        teams: (await tx.select().from(teams).where(eq(teams.organizationId, a.orgId))).length,
        teamMembers: (await tx.select().from(teamMembers).where(eq(teamMembers.organizationId, a.orgId))).length,
        rescuerProfiles: (await tx.select().from(rescuerProfiles).where(eq(rescuerProfiles.organizationId, a.orgId))).length,
        organizations: (await tx.select({ id: organizations.id }).from(organizations)).map((o) => o.id),
      };
    });
    expect(seen).toEqual({ memberships: 0, usersOfA: 0, teams: 0, teamMembers: 0, rescuerProfiles: 0, organizations: [b.orgId] });
  });

  it('the same holds for the rescuer of B, whose context is the narrowest', async () => {
    const seen = await database.withContext(ctx(b, b.rescuer), async (tx) => ({
      teams: (await tx.select().from(teams).where(eq(teams.organizationId, a.orgId))).length,
      organizations: (await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, a.orgId))).length,
    }));
    expect(seen).toEqual({ teams: 0, organizations: 0 });
  });

  it('inserting a row with the organization_id of A fails, and nothing is written', async () => {
    const insertions = [
      () => database.withContext(ctx(b, b.admin), (tx) => tx.insert(teams).values({ organizationId: a.orgId, name: 'Intruder', locality: 'X' })),
      () => database.withContext(ctx(b, b.admin), (tx) => tx.insert(teamMembers).values({ teamId: a.teamId, userId: b.rescuer.userId, organizationId: a.orgId })),
      () => database.withContext(ctx(b, b.admin), (tx) => tx.insert(rescuerProfiles).values({ organizationId: a.orgId, userId: b.coordinator.userId, fullName: 'Intruder' })),
      () => database.withContext(ctx(b, b.admin), (tx) => tx.insert(memberships).values({ organizationId: a.orgId, userId: pending.userId, role: 'admin' })),
    ];
    for (const insert of insertions) await expect(insert()).rejects.toThrow();
    expect(await fixtures.query(`SELECT 1 FROM teams WHERE name = 'Intruder'`)).toEqual([]);
    expect(await fixtures.query(`SELECT 1 FROM memberships WHERE user_id = $1`, [pending.userId])).toEqual([]);
  });

  it('B cannot rewrite organization A, either', async () => {
    const changed = await database.withContext(ctx(b, b.admin), (tx) => tx.update(organizations).set({ name: 'Hijacked' }).where(eq(organizations.id, a.orgId)).returning({ id: organizations.id }));
    expect(changed).toEqual([]);
    expect((await fixtures.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [a.orgId]))[0]?.name).toBe(a.name);
  });
});

describe('INV-25: an account waiting for approval', () => {
  it('gets 403 ACCOUNT_PENDING on getOrganization, with the single error format', async () => {
    const session = await mustLogin(app, pending.email, TEST_PASSWORD);
    expect(session.body.user).toMatchObject({ accountStatus: 'pending', organization: null, role: null, nextStep: 'awaiting-approval' });
    const response = await getOrganization(session);
    expect(response.status).toBe(ERROR_HTTP.ACCOUNT_PENDING);
    const body = ErrorResponse.parse(await response.json());
    expect(body.error.code).toBe('ACCOUNT_PENDING');
    expect(JSON.stringify(body)).not.toContain(a.name);
  });

  it('its own context sees no row of any organization table', async () => {
    const principal = { userId: pending.userId, orgId: null, role: 'pending' as const };
    const seen = await database.withPrincipal(principal, async (tx) => ({
      organizations: (await tx.select().from(organizations)).length,
      memberships: (await tx.select().from(memberships)).length,
      teams: (await tx.select().from(teams)).length,
      teamMembers: (await tx.select().from(teamMembers)).length,
      rescuerProfiles: (await tx.select().from(rescuerProfiles)).length,
      users: (await tx.select({ id: users.id }).from(users)).map((u) => u.id),
    }));
    expect(seen).toEqual({ organizations: 0, memberships: 0, teams: 0, teamMembers: 0, rescuerProfiles: 0, users: [pending.userId] });
  });
});
