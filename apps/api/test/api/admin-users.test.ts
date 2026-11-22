import { randomUUID } from 'node:crypto';
import { AdminUserDetail, ERROR_HTTP, ErrorResponse, UsersPage } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { login, mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// RF-813, doc 06 §7.1, rule 1 (INV-01), rule 3, D-U2 to D-U6, INV-25 and INV-29, against a real PostGIS.

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

const patch = (session: Session, userId: string, body: unknown) =>
  fetch(`${app.baseUrl}/admin/users/${userId}`, { method: 'PATCH', headers: { ...withSession(session), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const updated = async (response: Response) => {
  expect(response.status).toBe(200);
  return AdminUserDetail.parse(await response.json());
};
const audit = (userId: string, action: string) =>
  fixtures.query<{ detail: Record<string, unknown>; actor_user_id: string; subject_user_id: string }>(
    `SELECT detail, actor_user_id, subject_user_id FROM audit_log WHERE entity_id = $1 AND action = $2`,
    [userId, action],
  );
const openMission = async (orgId: string, coordinator: Member, status: 'planning' | 'active' | 'closed' = 'active') => {
  const id = randomUUID();
  await fixtures.query(
    `INSERT INTO missions (id, organization_id, name, coordinator_id, status, target, target_source, created_by, activated_at, closed_at) VALUES ($1, $2, $3, $4, $5, 'POINT Z (0 0 0)', 'map', $4, $6, $7)`,
    [id, orgId, `Mission ${id}`, coordinator.userId, status, status === 'planning' ? null : new Date(), status === 'closed' ? new Date() : null],
  );
  return id;
};
const responsibleOf = async (missionId: string) => (await fixtures.query<{ coordinator_id: string }>(`SELECT coordinator_id FROM missions WHERE id = $1`, [missionId]))[0]!.coordinator_id;

describe('updateUser: the role (RF-813, INV-29, D-U3)', () => {
  let org: Org;

  beforeAll(async () => {
    org = await organization('UsersRole');
  });

  it('Q-36: whoever becomes coordinator without an alias gets one from the visible name; one that already has it keeps it', async () => {
    const aliasOf = async (m: Member) => (await fixtures.query<{ alias: string | null }>(`SELECT alias FROM memberships WHERE user_id = $1`, [m.userId]))[0]!.alias;
    const fresh = await fixtures.member(org.orgId, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
    await rename(fresh, 'Lucía Gómez');
    await patch(org.session, fresh.userId, { role: 'coordinator' });
    expect(await aliasOf(fresh)).toBe('lucgom');
    const kept = await fixtures.member(org.orgId, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
    await fixtures.query(`UPDATE memberships SET alias = 'viejo' WHERE user_id = $1`, [kept.userId]);
    await rename(kept, 'Nombre Nuevo');
    await patch(org.session, kept.userId, { role: 'admin' });
    expect(await aliasOf(kept)).toBe('viejo');
  });

  it('rescuer to coordinator: the profile stays, the audit has {from, to} and the next request already uses the new role', async () => {
    const person = await fixtures.member(org.orgId, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    const before = await fetch(`${app.baseUrl}/admin/users`, { headers: withSession(session, false) });
    await expectError(before, 'FORBIDDEN');

    const result = await updated(await patch(org.session, person.userId, { role: 'coordinator' }));
    expect(result).toMatchObject({ userId: person.userId, role: 'coordinator', profileStatus: null });
    expect((await fixtures.query(`SELECT status FROM rescuer_profiles WHERE user_id = $1`, [person.userId]))[0]).toMatchObject({ status: 'complete' });
    const [line, ...rest] = await audit(person.userId, 'role_changed');
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ detail: { from: 'rescuer', to: 'coordinator' }, actor_user_id: org.admin.userId, subject_user_id: person.userId });
    // same session, no new login: a coordinator may list the missions, a rescuer could not
    const after = await fetch(`${app.baseUrl}/missions`, { headers: withSession(session, false) });
    expect(after.status).toBe(200);
  });

  it('coordinator to rescuer creates an incomplete profile, and back to rescuer later recovers the old one (D-U3)', async () => {
    const person = await fixtures.member(org.orgId, 'coordinator', 'active');
    await fixtures.query(`UPDATE users SET display_name = 'Pedro Coord' WHERE id = $1`, [person.userId]);
    const result = await updated(await patch(org.session, person.userId, { role: 'rescuer' }));
    expect(result).toMatchObject({ role: 'rescuer', profileStatus: 'incomplete' });
    expect(await fixtures.query(`SELECT full_name, status FROM rescuer_profiles WHERE user_id = $1`, [person.userId])).toEqual([{ full_name: 'Pedro Coord', status: 'incomplete' }]);
    await updated(await patch(org.session, person.userId, { role: 'admin' }));
    await updated(await patch(org.session, person.userId, { role: 'rescuer' }));
    expect(await fixtures.query(`SELECT 1 FROM rescuer_profiles WHERE user_id = $1`, [person.userId])).toHaveLength(1);
    expect(await audit(person.userId, 'role_changed')).toHaveLength(3);
  });

  it('to administrator', async () => {
    const person = await fixtures.member(org.orgId, 'coordinator', 'active');
    expect((await updated(await patch(org.session, person.userId, { role: 'admin' }))).role).toBe('admin');
    expect((await audit(person.userId, 'role_changed'))[0]!.detail).toEqual({ from: 'coordinator', to: 'admin' });
  });

  it('only the administrator changes a role: the coordinator and the rescuer get 403 and nothing changes (INV-29)', async () => {
    const target = await fixtures.member(org.orgId, 'rescuer', 'active');
    for (const who of [org.coordinator, org.rescuer]) {
      const session = await mustLogin(app, who.email, TEST_PASSWORD);
      await expectError(await patch(session, target.userId, { role: 'admin' }), 'FORBIDDEN');
    }
    expect((await fixtures.query(`SELECT role FROM memberships WHERE user_id = $1`, [target.userId]))[0]).toEqual({ role: 'rescuer' });
    expect(await audit(target.userId, 'role_changed')).toEqual([]);
  });

  it('a change that changes nothing, or an empty body, is refused', async () => {
    const person = await fixtures.member(org.orgId, 'rescuer', 'active');
    await expectError(await patch(org.session, person.userId, { role: 'rescuer' }), 'INVALID_STATE_TRANSITION');
    await expectError(await patch(org.session, person.userId, {}), 'VALIDATION_FAILED');
    await expectError(await patch(org.session, person.userId, { role: 'boss' }), 'VALIDATION_FAILED');
    await expectError(await patch(org.session, person.userId, { role: 'admin', extra: 1 }), 'VALIDATION_FAILED');
  });

  it('another organization and an unknown id are 404, and nothing is written (INV-01)', async () => {
    const other = await organization('UsersRoleOther');
    await expectError(await patch(org.session, other.rescuer.userId, { role: 'coordinator' }), 'NOT_FOUND');
    await expectError(await patch(org.session, randomUUID(), { role: 'coordinator' }), 'NOT_FOUND');
    await expectError(await patch(org.session, (await fixtures.applicant(org.orgId, 'pending')).userId, { accountStatus: 'active' }), 'NOT_FOUND');
    expect((await fixtures.query(`SELECT role FROM memberships WHERE user_id = $1`, [other.rescuer.userId]))[0]).toEqual({ role: 'rescuer' });
  });
});

describe('updateUser: disable and reactivate (INV-25)', () => {
  let org: Org;

  beforeAll(async () => {
    org = await organization('UsersStatus');
  });

  it('disabling closes the session (401), leaves account_disabled and cannot log in; reactivating leaves account_active and lets the person in', async () => {
    const person = await fixtures.member(org.orgId, 'rescuer', 'active', { password: TEST_PASSWORD, profile: 'complete' });
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    expect((await fetch(`${app.baseUrl}/my/skills`, { headers: withSession(session, false) })).status).toBe(200);

    const off = await updated(await patch(org.session, person.userId, { accountStatus: 'disabled' }));
    expect(off.accountStatus).toBe('disabled');
    await expectError(await fetch(`${app.baseUrl}/my/skills`, { headers: withSession(session, false) }), 'UNAUTHENTICATED');
    expect(await audit(person.userId, 'account_disabled')).toHaveLength(1);
    expect((await login(app, person.email, TEST_PASSWORD)).response.status).not.toBe(200);

    const on = await updated(await patch(org.session, person.userId, { accountStatus: 'active' }));
    expect(on.accountStatus).toBe('active');
    expect(await audit(person.userId, 'account_active')).toHaveLength(1);
    await mustLogin(app, person.email, TEST_PASSWORD);
  });

  it('reactivating an active account, or disabling a disabled one, is INVALID_STATE_TRANSITION', async () => {
    const active = await fixtures.member(org.orgId, 'rescuer', 'active');
    const disabled = await fixtures.member(org.orgId, 'rescuer', 'disabled');
    await expectError(await patch(org.session, active.userId, { accountStatus: 'active' }), 'INVALID_STATE_TRANSITION');
    await expectError(await patch(org.session, disabled.userId, { accountStatus: 'disabled' }), 'INVALID_STATE_TRANSITION');
    expect(await audit(active.userId, 'account_active')).toEqual([]);
  });

  it('a role and a state in one request both apply', async () => {
    const person = await fixtures.member(org.orgId, 'rescuer', 'active');
    const result = await updated(await patch(org.session, person.userId, { role: 'coordinator', accountStatus: 'disabled' }));
    expect(result).toMatchObject({ role: 'coordinator', accountStatus: 'disabled' });
  });
});

describe('updateUser: a coordinator with missions (RN-11, INV-03, INV-11, D-U1, D-U2)', () => {
  let org: Org;

  beforeAll(async () => {
    org = await organization('UsersMissions');
  });

  it('disabling is COORDINATOR_HAS_MISSIONS with the ids of the open missions, and nothing changes', async () => {
    const lead = await fixtures.member(org.orgId, 'coordinator', 'active');
    const planning = await openMission(org.orgId, lead, 'planning');
    const active = await openMission(org.orgId, lead, 'active');
    await openMission(org.orgId, lead, 'closed');
    const error = await expectError(await patch(org.session, lead.userId, { accountStatus: 'disabled' }), 'COORDINATOR_HAS_MISSIONS');
    expect((error.error.details as { missionIds: string[] }).missionIds.sort()).toEqual([planning, active].sort());
    expect((await fixtures.query(`SELECT account_status FROM users WHERE id = $1`, [lead.userId]))[0]).toEqual({ account_status: 'active' });
    expect(await audit(lead.userId, 'account_disabled')).toEqual([]);
  });

  it('with reassignMissionsTo, the open missions move, the closed one stays, each leaves its line and the account is disabled', async () => {
    const lead = await fixtures.member(org.orgId, 'coordinator', 'active');
    const next = await fixtures.member(org.orgId, 'coordinator', 'active');
    const planning = await openMission(org.orgId, lead, 'planning');
    const active = await openMission(org.orgId, lead, 'active');
    const closed = await openMission(org.orgId, lead, 'closed');
    const result = await updated(await patch(org.session, lead.userId, { accountStatus: 'disabled', reassignMissionsTo: next.userId }));
    expect(result).toMatchObject({ accountStatus: 'disabled', hasMissionsAsResponsible: 0 });
    expect(await responsibleOf(planning)).toBe(next.userId);
    expect(await responsibleOf(active)).toBe(next.userId);
    expect(await responsibleOf(closed)).toBe(lead.userId);
    for (const id of [planning, active]) {
      const [line] = await audit(id, 'mission_updated');
      expect(line!.detail).toMatchObject({ fields: ['coordinatorId'], reassignedFrom: lead.userId, reassignedTo: next.userId });
    }
    expect(await audit(closed, 'mission_updated')).toEqual([]);
  });

  it('changing the role of a coordinator with open missions needs it too (D-U2), and with it everything happens together', async () => {
    const lead = await fixtures.member(org.orgId, 'coordinator', 'active');
    const next = await fixtures.member(org.orgId, 'coordinator', 'active');
    const mission = await openMission(org.orgId, lead, 'active');
    await expectError(await patch(org.session, lead.userId, { role: 'rescuer' }), 'COORDINATOR_HAS_MISSIONS');
    const result = await updated(await patch(org.session, lead.userId, { role: 'rescuer', reassignMissionsTo: next.userId }));
    expect(result.role).toBe('rescuer');
    expect(await responsibleOf(mission)).toBe(next.userId);
  });

  it('a coordinator without open missions needs nothing, and a reassignment that is not needed is ignored', async () => {
    const lead = await fixtures.member(org.orgId, 'coordinator', 'active');
    await openMission(org.orgId, lead, 'closed');
    await updated(await patch(org.session, lead.userId, { accountStatus: 'disabled', reassignMissionsTo: randomUUID() }));
  });

  it.each([
    ['a rescuer', async () => (await fixtures.member(org.orgId, 'rescuer', 'active')).userId],
    ['an administrator', async () => org.admin.userId],
    ['a disabled coordinator', async () => (await fixtures.member(org.orgId, 'coordinator', 'disabled')).userId],
    ['a person of another organization', async () => (await fixtures.member(await fixtures.organization('Elsewhere'), 'coordinator', 'active')).userId],
    ['an unknown id', async () => randomUUID()],
  ])('%s is not a valid new responsible: VALIDATION_FAILED on reassignMissionsTo, and the whole change is undone', async (_name, destination) => {
    const lead = await fixtures.member(org.orgId, 'coordinator', 'active');
    const mission = await openMission(org.orgId, lead, 'active');
    const failed = await expectError(await patch(org.session, lead.userId, { accountStatus: 'disabled', reassignMissionsTo: await destination() }), 'VALIDATION_FAILED');
    expect((failed.error.details as { issues: { path: string }[] }).issues[0]!.path).toBe('reassignMissionsTo');
    expect(await responsibleOf(mission)).toBe(lead.userId);
    expect((await fixtures.query(`SELECT account_status FROM users WHERE id = $1`, [lead.userId]))[0]).toEqual({ account_status: 'active' });
  });

  it('the person herself is not a valid destination', async () => {
    const lead = await fixtures.member(org.orgId, 'coordinator', 'active');
    await openMission(org.orgId, lead, 'active');
    await expectError(await patch(org.session, lead.userId, { accountStatus: 'disabled', reassignMissionsTo: lead.userId }), 'VALIDATION_FAILED');
  });
});

describe('updateUser: LAST_ADMIN (D-U5)', () => {
  it('the only active administrator can neither lose the role nor be disabled, and nothing changes', async () => {
    const org = await organization('UsersLast');
    await expectError(await patch(org.session, org.admin.userId, { role: 'coordinator' }), 'LAST_ADMIN');
    await expectError(await patch(org.session, org.admin.userId, { accountStatus: 'disabled' }), 'LAST_ADMIN');
    expect((await fixtures.query(`SELECT role FROM memberships WHERE user_id = $1`, [org.admin.userId]))[0]).toEqual({ role: 'admin' });
    expect(await audit(org.admin.userId, 'role_changed')).toEqual([]);
  });

  it('a disabled administrator does not count: the active one is still the last', async () => {
    const org = await organization('UsersLastDisabled');
    await fixtures.member(org.orgId, 'admin', 'disabled');
    await expectError(await patch(org.session, org.admin.userId, { role: 'rescuer' }), 'LAST_ADMIN');
  });

  it('with two administrators, one can step down (and then the other is the last)', async () => {
    const org = await organization('UsersTwo');
    const second = await fixtures.member(org.orgId, 'admin', 'active', options);
    const secondSession = await mustLogin(app, second.email, TEST_PASSWORD);
    expect((await updated(await patch(org.session, org.admin.userId, { role: 'coordinator' }))).role).toBe('coordinator');
    await expectError(await patch(secondSession, second.userId, { accountStatus: 'disabled' }), 'LAST_ADMIN');
  });
});

describe('anonymized accounts (INV-22)', () => {
  it('are not listed and are a 404 for getUser and updateUser, and nothing changes', async () => {
    const org = await organization('UsersAnon');
    const gone = await fixtures.member(org.orgId, 'rescuer', 'active', { ...options, profile: 'complete' });
    await rename(gone, 'Anonima Persona');
    await fixtures.query(`UPDATE users SET account_status = 'disabled', anonymized_at = now() WHERE id = $1`, [gone.userId]);

    const listed = await page(await list(org.session, '?pageSize=100'));
    expect(listed.items.map((item) => item.userId)).not.toContain(gone.userId);
    expect(listed.total).toBe(listed.items.length);
    await expectError(await detail(org.session, gone.userId), 'NOT_FOUND');
    await expectError(await patch(org.session, gone.userId, { accountStatus: 'active' }), 'NOT_FOUND');
    await expectError(await patch(org.session, gone.userId, { role: 'coordinator' }), 'NOT_FOUND');
    expect((await fixtures.query(`SELECT m.role, u.account_status FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.id = $1`, [gone.userId]))[0]).toEqual({
      role: 'rescuer',
      account_status: 'disabled',
    });
  });
});
