import { randomUUID } from 'node:crypto';
import { DecideSignupResponse, ERROR_HTTP, ErrorResponse, SignupRequestsPage } from '@onway/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { DbConnection } from '../../src/db/config.js';
import { login, mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// RF-106, RN-25, INV-25, INV-29, INV-01 and D-A4 (the decision of a whole selection is atomic), against a real PostGIS.

let app: TestApp;
let fixtures: Fixtures;
let appConnection: DbConnection;

interface Org {
  orgId: string;
  admin: Member;
  coordinator: Member;
  rescuer: Member;
  session: Session;
}

async function organization(label: string): Promise<Org> {
  const orgId = await fixtures.organization(label);
  const options = { password: TEST_PASSWORD };
  const admin = await fixtures.member(orgId, 'admin', 'active', options);
  const coordinator = await fixtures.member(orgId, 'coordinator', 'active', options);
  const rescuer = await fixtures.member(orgId, 'rescuer', 'active', options);
  return { orgId, admin, coordinator, rescuer, session: await mustLogin(app, admin.email, TEST_PASSWORD) };
}

const applicant = (org: Org, name?: string) =>
  fixtures.applicant(org.orgId, 'pending', { password: TEST_PASSWORD }).then(async (m) => {
    if (name) await fixtures.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [m.userId, name]);
    return m;
  });
const at = (member: Member, iso: string) => fixtures.query(`UPDATE signup_requests SET requested_at = $2 WHERE user_id = $1`, [member.userId, iso]);

const list = (session: Session, query = '') => fetch(`${app.baseUrl}/admin/signup-requests${query}`, { headers: withSession(session, false) });
const decide = (session: Session, body: unknown) =>
  fetch(`${app.baseUrl}/admin/signup-requests/decide`, { method: 'POST', headers: { 'content-type': 'application/json', ...withSession(session) }, body: JSON.stringify(body) });
const ids = (...members: Member[]) => ({ mode: 'ids', ids: members.map((m) => m.userId) });

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed;
}

const requestOf = async (member: Member) =>
  (
    await fixtures.query<{ status: string; granted_role: string | null; decided_by: string | null }>(`SELECT status, granted_role, decided_by FROM signup_requests WHERE user_id = $1`, [member.userId])
  )[0]!;
const accountOf = async (member: Member) => (await fixtures.query<{ account_status: string }>(`SELECT account_status FROM users WHERE id = $1`, [member.userId]))[0]!.account_status;
const membershipOf = (member: Member) =>
  fixtures.query<{ role: string; status: string; organization_id: string }>(`SELECT role, status, organization_id FROM memberships WHERE user_id = $1`, [member.userId]);
const auditOf = (member: Member) =>
  fixtures.query<{ action: string; actor_user_id: string; organization_id: string }>(
    `SELECT action, actor_user_id, organization_id FROM audit_log WHERE entity_type = 'signup_request' AND entity_id = $1 AND action <> 'signup_requested'`,
    [member.userId],
  );
async function expectUntouched(...members: Member[]) {
  for (const member of members) {
    expect(await requestOf(member)).toEqual({ status: 'pending', granted_role: null, decided_by: null });
    expect(await accountOf(member)).toBe('pending');
    expect(await membershipOf(member)).toEqual([]);
    expect(await auditOf(member)).toEqual([]);
  }
}

beforeAll(async () => {
  const { owner, app: connection } = inject('database');
  appConnection = connection;
  fixtures = new Fixtures(owner);
  app = await startApp({ database: connection });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('listSignupRequests (RF-106, Q-34, INV-01)', () => {
  let org: Org;
  let other: Org;
  let ana: Member;
  let berta: Member;
  let carla: Member;
  let rejected: Member;
  let approved: Member;
  let foreign: Member;

  beforeAll(async () => {
    org = await organization('ListA');
    other = await organization('ListB');
    ana = await applicant(org, 'Ana List');
    berta = await applicant(org, 'Berta List');
    carla = await applicant(org, '100% Carla_List');
    await at(ana, '2026-01-01T10:00:00Z');
    await at(berta, '2026-01-02T10:00:00Z');
    await at(carla, '2026-01-03T10:00:00Z');
    rejected = await fixtures.applicant(org.orgId, 'rejected');
    approved = await applicant(org, 'Approved List');
    await fixtures.query(`UPDATE signup_requests SET status = 'approved', granted_role = 'rescuer', decided_at = now() WHERE user_id = $1`, [approved.userId]);
    foreign = await applicant(other, 'Ana List elsewhere');
  });

  it("returns the pending ones of the administrator's organization, most recent first, with exactly the fields of the contract", async () => {
    const response = await list(org.session);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const page = SignupRequestsPage.parse(await response.json());
    expect(page.items.map((i) => i.userId)).toEqual([carla.userId, berta.userId, ana.userId]);
    expect(page).toMatchObject({ page: 1, pageSize: 25, total: 3 });
    expect(page.items.every((i) => i.status === 'pending')).toBe(true);
    for (const item of page.items) expect(Object.keys(item).sort()).toEqual(['displayName', 'email', 'requestedAt', 'status', 'userId']);
    expect(page.items[2]).toEqual({ userId: ana.userId, email: ana.email, displayName: 'Ana List', status: 'pending', requestedAt: '2026-01-01T10:00:00.000Z' });
  });

  it('never lists a request of another organization (INV-01), and the other administrator sees only theirs', async () => {
    const page = SignupRequestsPage.parse(await (await list(org.session, '?pageSize=200')).json());
    expect(page.items.map((i) => i.userId)).not.toContain(foreign.userId);
    const theirs = SignupRequestsPage.parse(await (await list(other.session)).json());
    expect(theirs.items.map((i) => i.userId)).toEqual([foreign.userId]);
  });

  it('carries no personal data beyond email and name: not even a phone, document, address or role', async () => {
    const text = await (await list(org.session, '?status=approved')).text();
    expect(Object.keys(JSON.parse(text).items[0]).sort()).toEqual(['displayName', 'email', 'requestedAt', 'status', 'userId']);
    expect(text).not.toMatch(/phone|document|address|role|granted|password|hash/i);
  });

  it('paginates and reports the total of the filtered results', async () => {
    const first = SignupRequestsPage.parse(await (await list(org.session, '?pageSize=2')).json());
    expect(first.items.map((i) => i.userId)).toEqual([carla.userId, berta.userId]);
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    const second = SignupRequestsPage.parse(await (await list(org.session, '?pageSize=2&page=2')).json());
    expect(second.items.map((i) => i.userId)).toEqual([ana.userId]);
    expect(second.total).toBe(3);
    const beyond = SignupRequestsPage.parse(await (await list(org.session, '?pageSize=2&page=9')).json());
    expect(beyond.items).toEqual([]);
  });

  it('filters by status', async () => {
    const rejectedPage = SignupRequestsPage.parse(await (await list(org.session, '?status=rejected')).json());
    expect(rejectedPage.items.map((i) => i.userId)).toEqual([rejected.userId]);
    expect(rejectedPage.items[0]!.status).toBe('rejected');
    const approvedPage = SignupRequestsPage.parse(await (await list(org.session, '?status=approved')).json());
    expect(approvedPage.items.map((i) => i.userId)).toEqual([approved.userId]);
    await expectError(await list(org.session, '?status=disabled'), 'VALIDATION_FAILED');
  });

  it('searches by name or email, ignoring case, and treats % and _ as plain characters', async () => {
    const byName = SignupRequestsPage.parse(await (await list(org.session, '?q=BERTA')).json());
    expect(byName.items.map((i) => i.userId)).toEqual([berta.userId]);
    const byEmail = SignupRequestsPage.parse(await (await list(org.session, `?q=${encodeURIComponent(ana.email.slice(0, 20))}`)).json());
    expect(byEmail.items.map((i) => i.userId)).toEqual([ana.userId]);
    const wildcard = SignupRequestsPage.parse(await (await list(org.session, `?q=${encodeURIComponent('%')}`)).json());
    expect(wildcard.items.map((i) => i.userId)).toEqual([carla.userId]);
    const underscore = SignupRequestsPage.parse(await (await list(org.session, `?q=${encodeURIComponent('a_L')}`)).json());
    expect(underscore.items.map((i) => i.userId)).toEqual([carla.userId]);
    const none = SignupRequestsPage.parse(await (await list(org.session, '?q=zzzz-nobody')).json());
    expect(none).toMatchObject({ items: [], total: 0 });
  });
});

describe('decideSignupRequests: one person (RF-106, RN-25, INV-25, INV-29)', () => {
  let org: Org;
  beforeAll(async () => {
    org = await organization('Decide');
  });

  it('approving as rescuer activates the account, grants an active rescuer membership, opens the profile and audits', async () => {
    const person = await applicant(org);
    const response = await decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(person) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(DecideSignupResponse.parse(await response.json())).toEqual({ affected: 1, skipped: [] });
    expect(await accountOf(person)).toBe('active');
    expect(await requestOf(person)).toEqual({ status: 'approved', granted_role: 'rescuer', decided_by: org.admin.userId });
    expect(await membershipOf(person)).toEqual([{ role: 'rescuer', status: 'active', organization_id: org.orgId }]);
    expect(await fixtures.query(`SELECT status FROM rescuer_profiles WHERE user_id = $1`, [person.userId])).toEqual([{ status: 'incomplete' }]);
    expect(await auditOf(person)).toEqual([{ action: 'signup_approved', actor_user_id: org.admin.userId, organization_id: org.orgId }]);
    // The next login of a rescuer leads to «Completa tu perfil».
    const { session } = await login(app, person.email, TEST_PASSWORD);
    expect(session?.body.user).toMatchObject({ accountStatus: 'active', role: 'rescuer', profileStatus: 'incomplete', nextStep: 'complete-profile' });
  });

  it('approving as coordinator grants the coordinator role (only the administrator can: INV-29) and the login goes home', async () => {
    const person = await applicant(org);
    expect(DecideSignupResponse.parse(await (await decide(org.session, { action: 'approve', role: 'coordinator', selection: ids(person) })).json()).affected).toBe(1);
    expect(await requestOf(person)).toMatchObject({ status: 'approved', granted_role: 'coordinator' });
    expect(await membershipOf(person)).toEqual([{ role: 'coordinator', status: 'active', organization_id: org.orgId }]);
    expect(await fixtures.query(`SELECT 1 FROM rescuer_profiles WHERE user_id = $1`, [person.userId])).toEqual([]);
    const { session } = await login(app, person.email, TEST_PASSWORD);
    expect(session?.body.user).toMatchObject({ role: 'coordinator', nextStep: 'home' });
  });

  it('rejecting leaves a rejected account with no membership, and the login answers ACCOUNT_REJECTED (INV-25)', async () => {
    const person = await applicant(org);
    expect(DecideSignupResponse.parse(await (await decide(org.session, { action: 'reject', selection: ids(person) })).json())).toEqual({ affected: 1, skipped: [] });
    expect(await accountOf(person)).toBe('rejected');
    expect(await requestOf(person)).toEqual({ status: 'rejected', granted_role: null, decided_by: org.admin.userId });
    expect(await membershipOf(person)).toEqual([]);
    expect(await auditOf(person)).toEqual([{ action: 'signup_rejected', actor_user_id: org.admin.userId, organization_id: org.orgId }]);
    await expectError((await login(app, person.email, TEST_PASSWORD)).response, 'ACCOUNT_REJECTED');
  });

  it('approving without a role, rejecting with one, an unknown role and an empty selection are VALIDATION_FAILED and decide nothing', async () => {
    const person = await applicant(org);
    await expectError(await decide(org.session, { action: 'approve', selection: ids(person) }), 'VALIDATION_FAILED');
    await expectError(await decide(org.session, { action: 'reject', role: 'rescuer', selection: ids(person) }), 'VALIDATION_FAILED');
    await expectError(await decide(org.session, { action: 'approve', role: 'admin', selection: ids(person) }), 'VALIDATION_FAILED');
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', selection: { mode: 'ids', ids: [] } }), 'VALIDATION_FAILED');
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', selection: { mode: 'ids', ids: ['not-a-uuid'] } }), 'VALIDATION_FAILED');
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', extra: 1, selection: ids(person) }), 'VALIDATION_FAILED');
    await expectUntouched(person);
  });

  it('a request that is not in this organization, or does not exist, is 404 (INV-01) and the other organization is not touched', async () => {
    const other = await organization('DecideOther');
    const theirs = await applicant(other);
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(theirs) }), 'NOT_FOUND');
    await expectError(await decide(org.session, { action: 'reject', selection: { mode: 'ids', ids: [randomUUID()] } }), 'NOT_FOUND');
    await expectUntouched(theirs);
    // Not even a user of this very organization that has no request: a rescuer is not a request.
    await expectError(await decide(org.session, { action: 'reject', selection: ids(org.rescuer) }), 'NOT_FOUND');
    expect(await accountOf(org.rescuer)).toBe('active');
  });

  it('a request that was already decided is 409 INVALID_STATE_TRANSITION and is not decided twice', async () => {
    const person = await applicant(org);
    await decide(org.session, { action: 'reject', selection: ids(person) });
    await expectError(await decide(org.session, { action: 'approve', role: 'coordinator', selection: ids(person) }), 'INVALID_STATE_TRANSITION');
    expect(await requestOf(person)).toMatchObject({ status: 'rejected', granted_role: null });
    expect(await membershipOf(person)).toEqual([]);
    expect(await auditOf(person)).toHaveLength(1);
  });

  it('lists a decided request under its new status and no longer as pending', async () => {
    const person = await applicant(org, 'Listed after');
    await decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(person) });
    const pending = SignupRequestsPage.parse(await (await list(org.session, '?q=Listed after')).json());
    expect(pending.items).toEqual([]);
    const done = SignupRequestsPage.parse(await (await list(org.session, '?status=approved&q=Listed after')).json());
    expect(done.items.map((i) => i.userId)).toEqual([person.userId]);
  });
});

describe('decideSignupRequests: a selection is decided all or nothing (D-A4)', () => {
  let org: Org;
  beforeAll(async () => {
    org = await organization('Bulk');
  });

  it('decides three people in one request, with the audit rows of each', async () => {
    const people = [await applicant(org), await applicant(org), await applicant(org)];
    const response = await decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(...people) });
    expect(DecideSignupResponse.parse(await response.json())).toEqual({ affected: 3, skipped: [] });
    for (const person of people) {
      expect(await accountOf(person)).toBe('active');
      expect(await auditOf(person)).toHaveLength(1);
    }
  });

  it('the same id twice counts once', async () => {
    const person = await applicant(org);
    const response = await decide(org.session, { action: 'reject', selection: { mode: 'ids', ids: [person.userId, person.userId] } });
    expect(DecideSignupResponse.parse(await response.json()).affected).toBe(1);
    expect(await auditOf(person)).toHaveLength(1);
  });

  it('three people and one id of another organization: 404 and none of the three changes', async () => {
    const other = await organization('BulkOther');
    const foreign = await applicant(other);
    const people = [await applicant(org), await applicant(org), await applicant(org)];
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(people[0]!, foreign, people[1]!, people[2]!) }), 'NOT_FOUND');
    await expectUntouched(...people, foreign);
  });

  it('three people and one already decided: 409 and none of the three changes', async () => {
    const decided = await applicant(org);
    await decide(org.session, { action: 'reject', selection: ids(decided) });
    const people = [await applicant(org), await applicant(org), await applicant(org)];
    await expectError(await decide(org.session, { action: 'approve', role: 'coordinator', selection: ids(...people, decided) }), 'INVALID_STATE_TRANSITION');
    await expectUntouched(...people);
    expect(await accountOf(decided)).toBe('rejected');
  });

  it('a failure in the middle of the loop rolls back the people decided before it, audit rows included', async () => {
    // A pending request whose account already has a membership: admin_decide_signup raises in its last step. The two before it
    // were already decided inside the transaction when it does, so only a real rollback leaves them pending.
    const people = [await applicant(org), await applicant(org), await applicant(org)];
    await at(people[0]!, '2026-02-01T10:00:00Z');
    await at(people[1]!, '2026-02-02T10:00:00Z');
    await at(people[2]!, '2026-02-03T10:00:00Z');
    await fixtures.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'rescuer')`, [org.orgId, people[2]!.userId]);
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(...people) }), 'INVALID_STATE_TRANSITION');
    for (const person of people) {
      expect(await requestOf(person)).toEqual({ status: 'pending', granted_role: null, decided_by: null });
      expect(await accountOf(person)).toBe('pending');
      expect(await auditOf(person)).toEqual([]);
    }
    expect(await membershipOf(people[0]!)).toEqual([]);
    expect(await fixtures.query(`SELECT 1 FROM rescuer_profiles WHERE user_id = $1`, [people[0]!.userId])).toEqual([]);
  });

  it('«all the results of the filter» decides what matches except the excluded ones, and nothing else', async () => {
    const tag = `Zebra${Date.now()}`;
    const matching = [await applicant(org, `${tag} one`), await applicant(org, `${tag} two`), await applicant(org, `${tag} three`)];
    const unrelated = await applicant(org, 'Someone else');
    const other = await organization('BulkFilterOther');
    const foreign = await applicant(other, `${tag} elsewhere`);
    const response = await decide(org.session, {
      action: 'approve',
      role: 'rescuer',
      selection: { mode: 'filter', filter: { status: 'pending', q: tag }, exceptIds: [matching[1]!.userId] },
    });
    expect(DecideSignupResponse.parse(await response.json())).toEqual({ affected: 2, skipped: [] });
    expect(await accountOf(matching[0]!)).toBe('active');
    expect(await accountOf(matching[2]!)).toBe('active');
    await expectUntouched(matching[1]!, unrelated, foreign);
  });

  it('a filter with no results decides nobody; a filter on an already decided status is 409 and changes nothing', async () => {
    const none = await decide(org.session, { action: 'reject', selection: { mode: 'filter', filter: { status: 'pending', q: 'no-one-has-this-name' }, exceptIds: [] } });
    expect(DecideSignupResponse.parse(await none.json())).toEqual({ affected: 0, skipped: [] });
    const rejected = await fixtures.applicant(org.orgId, 'rejected');
    await expectError(await decide(org.session, { action: 'approve', role: 'rescuer', selection: { mode: 'filter', filter: { status: 'rejected' }, exceptIds: [] } }), 'INVALID_STATE_TRANSITION');
    expect(await requestOf(rejected)).toMatchObject({ status: 'rejected' });
  });

  it('two administrators deciding the same person at once: exactly one wins and the account stays consistent', async () => {
    const second = await fixtures.member(org.orgId, 'admin', 'active', { password: TEST_PASSWORD });
    const secondSession = await mustLogin(app, second.email, TEST_PASSWORD);
    for (let round = 0; round < 5; round++) {
      const person = await applicant(org);
      const [a, b] = await Promise.all([decide(org.session, { action: 'approve', role: 'rescuer', selection: ids(person) }), decide(secondSession, { action: 'reject', selection: ids(person) })]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const status = (await requestOf(person)).status;
      expect(await accountOf(person)).toBe(status === 'approved' ? 'active' : 'rejected');
      expect(await membershipOf(person)).toHaveLength(status === 'approved' ? 1 : 0);
      expect(await auditOf(person)).toHaveLength(1);
    }
  });

  it('the administrator of another organization cannot decide these people (INV-01)', async () => {
    const other = await organization('BulkIntruder');
    const person = await applicant(org);
    await expectError(await decide(other.session, { action: 'approve', role: 'coordinator', selection: ids(person) }), 'NOT_FOUND');
    // And «everything that matches» in the other organization never reaches this one.
    const all = await decide(other.session, { action: 'reject', selection: { mode: 'filter', filter: { status: 'pending' }, exceptIds: [] } });
    expect(DecideSignupResponse.parse(await all.json()).affected).toBe(0);
    await expectUntouched(person);
  });
});

describe('who may call the administration of sign-ups (rule 2, INV-29)', () => {
  let org: Org;
  let person: Member;
  beforeAll(async () => {
    org = await organization('Roles');
    person = await applicant(org);
  });

  const calls = (session?: Session) => {
    const headers = session ? withSession(session) : { 'content-type': 'application/json' };
    const post = (path: string, body: unknown) => fetch(`${app.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return [
      () => fetch(`${app.baseUrl}/admin/signup-requests`, { headers }),
      () => post('/admin/signup-requests/decide', { action: 'approve', role: 'coordinator', selection: ids(person) }),
      () => fetch(`${app.baseUrl}/admin/invite-code`, { headers }),
      () => post('/admin/invite-code/rotate', {}),
    ];
  };

  it.each(['coordinator', 'rescuer'] as const)('the %s gets 403 FORBIDDEN in the four operations and decides nothing', async (role) => {
    const session = await mustLogin(app, org[role].email, TEST_PASSWORD);
    for (const call of calls(session)) await expectError(await call(), 'FORBIDDEN');
    await expectUntouched(person);
  });

  it('an anonymous caller gets 401 in the four operations', async () => {
    for (const call of calls()) await expectError(await call(), 'UNAUTHENTICATED');
    await expectUntouched(person);
  });

  it('a pending account reaches none of them (INV-25)', async () => {
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    for (const call of calls(session)) await expectError(await call(), 'ACCOUNT_PENDING');
    await expectUntouched(person);
  });

  it('a POST without the CSRF token is refused', async () => {
    const response = await fetch(`${app.baseUrl}/admin/signup-requests/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...withSession(org.session, false) },
      body: JSON.stringify({ action: 'reject', selection: ids(person) }),
    });
    await expectError(response, 'CSRF_FAILED');
    await expectUntouched(person);
  });
});

describe('row level security as onway_app (INV-25, INV-29, INV-01)', () => {
  let org: Org;
  let person: Member;
  beforeAll(async () => {
    org = await organization('Rls');
    person = await applicant(org);
  });

  /** Runs `fn` in a transaction with the context of `member`, and always rolls it back. */
  async function asMember<T>(member: Member, fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client(appConnection);
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)`, [org.orgId, member.userId, member.role]);
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }

  it.each(['coordinator', 'rescuer'] as const)('a %s cannot read signup_requests, change the invitation code or decide a request', async (role) => {
    await asMember(org[role], async (client) => {
      expect((await client.query(`SELECT 1 FROM signup_requests`)).rowCount).toBe(0);
      expect((await client.query(`UPDATE organizations SET invite_code = 'TAKEN-OVER-CODE-1', invite_rotated_at = now() WHERE id = $1`, [org.orgId])).rowCount).toBe(0);
      await expect(client.query(`SELECT admin_decide_signup($1::uuid, true, 'coordinator')`, [person.userId])).rejects.toMatchObject({ code: '42501' });
    });
    expect((await fixtures.query(`SELECT 1 FROM organizations WHERE id = $1 AND invite_code = 'TAKEN-OVER-CODE-1'`, [org.orgId])).length).toBe(0);
  });

  it('the administrator reads the requests of their organization and updates its code; the policy is closed to any other organization', async () => {
    await asMember(org.admin, async (client) => {
      expect((await client.query(`SELECT 1 FROM signup_requests`)).rowCount).toBe(1);
      expect((await client.query(`UPDATE organizations SET invite_code = 'ADMIN-OWN-CODE-1' WHERE id = $1`, [org.orgId])).rowCount).toBe(1);
      expect((await client.query(`UPDATE organizations SET invite_code = 'ADMIN-OTHER-CODE-1' WHERE id <> $1`, [org.orgId])).rowCount).toBe(0);
    });
  });
});
