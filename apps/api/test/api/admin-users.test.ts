import { randomUUID } from 'node:crypto';
import { AdminUserDetail, ERROR_HTTP, ErrorResponse, UsersPage } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// RF-813 (to see), doc 06 §7.1, rule 1 (INV-01), rule 3 and D-U6, against a real PostGIS. T4 adds `updateUser` to this file.

let app: TestApp;
let fixtures: Fixtures;

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
  session: Session;
}

const options = { password: TEST_PASSWORD };
async function organization(label: string): Promise<Org> {
  const orgId = await fixtures.organization(label);
  const admin = await fixtures.member(orgId, 'admin', 'active', options);
  const coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
  const rescuer = await fixtures.member(orgId, 'rescuer', 'active', { ...options, profile: 'complete' });
  return { orgId, admin, coordinator, rescuer, session: await mustLogin(app, admin.email, TEST_PASSWORD) };
}
const rename = (member: Member, name: string) => fixtures.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [member.userId, name]);

const list = (session: Session, query = '') => fetch(`${app.baseUrl}/admin/users${query}`, { headers: withSession(session, false) });
const detail = (session: Session, userId: string) => fetch(`${app.baseUrl}/admin/users/${userId}`, { headers: withSession(session, false) });

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed;
}
const page = async (response: Response) => {
  expect(response.status).toBe(200);
  return UsersPage.parse(await response.json());
};

beforeAll(async () => {
  const { owner, app: connection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: connection });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('listUsers (RF-813, D-U6, INV-01)', () => {
  let org: Org;
  let other: Org;
  let ana: Member;
  let berta: Member;
  let carla: Member;
  let disabledCoordinator: Member;
  let applicant: Member;
  let rejected: Member;

  beforeAll(async () => {
    org = await organization('UsersList');
    other = await organization('UsersListOther');
    await rename(org.admin, 'Zeta Admin');
    await rename(org.coordinator, 'Carlos Coord');
    await rename(org.rescuer, 'Dora Rescue');
    ana = await fixtures.member(org.orgId, 'rescuer', 'active'); // incomplete profile
    berta = await fixtures.member(org.orgId, 'rescuer', 'active', { profile: 'complete' });
    carla = await fixtures.member(org.orgId, 'rescuer', 'disabled');
    disabledCoordinator = await fixtures.member(org.orgId, 'coordinator', 'disabled');
    await rename(ana, 'Ana User');
    await rename(berta, 'berta User');
    await rename(carla, '100% Carla_User');
    await rename(disabledCoordinator, 'Baja Coord');
    applicant = await fixtures.applicant(org.orgId, 'pending');
    rejected = await fixtures.applicant(org.orgId, 'rejected');
    await rename(other.rescuer, 'Ana Foreign');
  });

  it('lists only the members of the organization (D-U6), ordered by name without regard to case, with the fields of the contract', async () => {
    const result = await page(await list(org.session, '?pageSize=50'));
    expect(result.total).toBe(7);
    expect(result.items.map((i) => i.displayName)).toEqual(['100% Carla_User', 'Ana User', 'Baja Coord', 'berta User', 'Carlos Coord', 'Dora Rescue', 'Zeta Admin']);
    // pending and rejected applicants are in the inbox, not here; neither is another organization
    const ids = result.items.map((i) => i.userId);
    expect(ids).not.toContain(applicant.userId);
    expect(ids).not.toContain(rejected.userId);
    expect(ids).not.toContain(other.rescuer.userId);
    const dora = result.items.find((i) => i.userId === org.rescuer.userId)!;
    expect(dora).toEqual({
      userId: org.rescuer.userId,
      displayName: 'Dora Rescue',
      email: org.rescuer.email,
      role: 'rescuer',
      accountStatus: 'active',
      lastLoginAt: null,
      profileStatus: 'complete',
      hasMissionsAsResponsible: 0,
    });
  });

  it('profileStatus is null except for rescuers, and an incomplete profile says so', async () => {
    const result = await page(await list(org.session, '?pageSize=50'));
    const by = Object.fromEntries(result.items.map((i) => [i.userId, i]));
    expect(by[org.admin.userId]!.profileStatus).toBeNull();
    expect(by[org.coordinator.userId]!.profileStatus).toBeNull();
    expect(by[ana.userId]!.profileStatus).toBe('incomplete');
    expect(by[berta.userId]!.profileStatus).toBe('complete');
  });

  it('lastLoginAt is the last access of the account', async () => {
    const result = await page(await list(org.session, '?pageSize=50')); // the administrator logged in to get here
    expect(result.items.find((i) => i.userId === org.admin.userId)!.lastLoginAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });

  it('searches by name and by email, with the wildcards of the text taken literally', async () => {
    expect((await page(await list(org.session, '?q=ana'))).items.map((i) => i.displayName)).toEqual(['Ana User']);
    expect((await page(await list(org.session, `?q=${encodeURIComponent(berta.email.toUpperCase())}`))).items.map((i) => i.userId)).toEqual([berta.userId]);
    expect((await page(await list(org.session, `?q=${encodeURIComponent('100% Carla_')}`))).items.map((i) => i.displayName)).toEqual(['100% Carla_User']);
    expect((await page(await list(org.session, `?q=${encodeURIComponent('Carla%User')}`))).items).toEqual([]);
    expect((await page(await list(org.session, '?q=no-one-has-this-name'))).total).toBe(0);
  });

  it('filters by role and by account status, and the filters combine', async () => {
    expect((await page(await list(org.session, '?role=coordinator&pageSize=50'))).items.map((i) => i.displayName)).toEqual(['Baja Coord', 'Carlos Coord']);
    expect((await page(await list(org.session, '?accountStatus=disabled&pageSize=50'))).items.map((i) => i.displayName)).toEqual(['100% Carla_User', 'Baja Coord']);
    const both = await page(await list(org.session, '?role=coordinator&accountStatus=disabled'));
    expect(both.items.map((i) => i.userId)).toEqual([disabledCoordinator.userId]);
    expect(both.total).toBe(1);
    expect((await page(await list(org.session, '?role=admin'))).items.map((i) => i.userId)).toEqual([org.admin.userId]);
  });

  it('paginates with the total of the filtered result', async () => {
    const first = await page(await list(org.session, '?pageSize=3'));
    expect(first).toMatchObject({ page: 1, pageSize: 3, total: 7 });
    expect(first.items).toHaveLength(3);
    const third = await page(await list(org.session, '?pageSize=3&page=3'));
    expect(third.items).toHaveLength(1);
    const seen = [...first.items, ...(await page(await list(org.session, '?pageSize=3&page=2'))).items, ...third.items].map((i) => i.userId);
    expect(new Set(seen).size).toBe(7);
    expect((await page(await list(org.session, '?pageSize=3&page=9'))).items).toEqual([]);
  });

  it('hasMissionsAsResponsible counts only the missions that are not closed', async () => {
    const coordinator = await fixtures.member(org.orgId, 'coordinator', 'active');
    await rename(coordinator, 'Mision Coord');
    const mission = (name: string, status: 'planning' | 'active' | 'closed') =>
      fixtures.query(
        `INSERT INTO missions (organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at, closed_at) VALUES ($1, $2, $3, $4, 'POINT Z (0 0 0)', 'map', $3, $5, $6)`,
        [org.orgId, `${name} ${randomUUID()}`, coordinator.userId, status, status === 'planning' ? null : new Date(), status === 'closed' ? new Date() : null],
      );
    await mission('Plan', 'planning');
    await mission('Act', 'active');
    await mission('Done', 'closed');
    const result = await page(await list(org.session, '?q=Mision Coord'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.hasMissionsAsResponsible).toBe(2);
  });

  it('the query is strict: an unknown role or page size is a 400', async () => {
    await expectError(await list(org.session, '?role=boss'), 'VALIDATION_FAILED');
    await expectError(await list(org.session, '?pageSize=0'), 'VALIDATION_FAILED');
  });

  it('is never cached', async () => {
    expect((await list(org.session)).headers.get('cache-control')).toBe('no-store');
  });
});

describe('getUser (RF-813, RF-808, rule 3, INV-01)', () => {
  let org: Org;
  let other: Org;
  let rescuer: Member;

  beforeAll(async () => {
    org = await organization('UsersDetail');
    other = await organization('UsersDetailOther');
    rescuer = await fixtures.member(org.orgId, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
    const [profile] = await fixtures.query<{ id: string }>(`SELECT id FROM rescuer_profiles WHERE user_id = $1`, [rescuer.userId]);
    await fixtures.query(`INSERT INTO rescuer_contact (profile_id, organization_id, phone) VALUES ($1, $2, '+34 600 000 001')`, [profile!.id, org.orgId]);
    await fixtures.query(`INSERT INTO skills (profile_id, organization_id, name, kind) VALUES ($1, $2, 'Zeta habilidad', 'skill'), ($1, $2, 'Beta curso', 'course')`, [profile!.id, org.orgId]);
    await fixtures.addToTeam(await fixtures.team(org.orgId, 'Equipo Uno'), rescuer);
    const archived = await fixtures.team(org.orgId, 'Equipo Viejo');
    await fixtures.addToTeam(archived, rescuer);
    await fixtures.query(`UPDATE teams SET status = 'archived' WHERE id = $1`, [archived]);
  });

  it('a rescuer: contact, skills as listMySkills gives them, active teams and creation date', async () => {
    const response = await detail(org.session, rescuer.userId);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const person = AdminUserDetail.parse(await response.json());
    expect(person).toMatchObject({ userId: rescuer.userId, email: rescuer.email, role: 'rescuer', accountStatus: 'active', profileStatus: 'complete', phone: '+34 600 000 001' });
    expect(person.skills.map((s) => [s.name, s.kind, s.hasCertificate])).toEqual([
      ['Beta curso', 'course', false],
      ['Zeta habilidad', 'skill', false],
    ]);
    expect(person.teams).toHaveLength(1);
    expect(person.teams[0]!.name).toMatch(/^Equipo Uno/);
    expect(person.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);

    // the same skills the person sees in her own list (same order and shape)
    const own = await mustLogin(app, rescuer.email, TEST_PASSWORD);
    const mine = (await (await fetch(`${app.baseUrl}/my/skills`, { headers: withSession(own, false) })).json()) as { items: unknown[] };
    expect(person.skills).toEqual(mine.items);
  });

  it('carries neither the document nor the address, in any form (rule 3)', async () => {
    const [profile] = await fixtures.query<{ id: string }>(`SELECT id FROM rescuer_profiles WHERE user_id = $1`, [rescuer.userId]);
    await fixtures.query(
      `INSERT INTO rescuer_sensitive (profile_id, organization_id, document_type, document_enc, document_hash, address_enc, key_id) VALUES ($1, $2, 'dni', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, 1) ON CONFLICT DO NOTHING`,
      [profile!.id, org.orgId],
    );
    expect(await fixtures.query(`SELECT 1 FROM rescuer_sensitive WHERE profile_id = $1`, [profile!.id])).toHaveLength(1);
    const text = await (await detail(org.session, rescuer.userId)).text();
    for (const word of ['document', 'address', 'enc', 'hash']) expect(text.toLowerCase()).not.toContain(word);
  });

  it('a person without a profile phone or teams: null and empty lists; staff: null profileStatus', async () => {
    const bare = AdminUserDetail.parse(await (await detail(org.session, org.coordinator.userId)).json());
    expect(bare).toMatchObject({ role: 'coordinator', profileStatus: null, phone: null, skills: [], teams: [] });
    const rescuerWithoutPhone = AdminUserDetail.parse(await (await detail(org.session, org.rescuer.userId)).json());
    expect(rescuerWithoutPhone).toMatchObject({ phone: null, skills: [], teams: [] });
  });

  it('a disabled account still has its detail', async () => {
    const gone = await fixtures.member(org.orgId, 'rescuer', 'disabled');
    expect(AdminUserDetail.parse(await (await detail(org.session, gone.userId)).json()).accountStatus).toBe('disabled');
  });

  it('a person of another organization, an applicant and an unknown id are 404 (INV-01)', async () => {
    await expectError(await detail(org.session, other.rescuer.userId), 'NOT_FOUND');
    await expectError(await detail(org.session, (await fixtures.applicant(org.orgId, 'pending')).userId), 'NOT_FOUND');
    await expectError(await detail(org.session, randomUUID()), 'NOT_FOUND');
    await expectError(await detail(org.session, 'not-an-id'), 'VALIDATION_FAILED');
  });
});

describe('access to the user operations', () => {
  let org: Org;
  let person: Member;

  beforeAll(async () => {
    org = await organization('UsersAccess');
    person = await fixtures.applicant(org.orgId, 'pending', { password: TEST_PASSWORD });
  });

  const calls = (session?: Session) => [
    () => fetch(`${app.baseUrl}/admin/users`, { headers: session ? withSession(session, false) : {} }),
    () => fetch(`${app.baseUrl}/admin/users/${org.rescuer.userId}`, { headers: session ? withSession(session, false) : {} }),
  ];

  it.each(['coordinator', 'rescuer'] as const)('the %s gets 403 FORBIDDEN', async (role) => {
    const session = await mustLogin(app, org[role].email, TEST_PASSWORD);
    for (const call of calls(session)) await expectError(await call(), 'FORBIDDEN');
  });

  it('an anonymous caller gets 401', async () => {
    for (const call of calls()) await expectError(await call(), 'UNAUTHENTICATED');
  });

  it('a pending account reaches none of them (INV-25)', async () => {
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    for (const call of calls(session)) await expectError(await call(), 'ACCOUNT_PENDING');
  });
});
