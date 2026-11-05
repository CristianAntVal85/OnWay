import { ERROR_HTTP, ErrorResponse, InviteCodeResponse } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newInviteCode } from '../../src/admin/invite-code.service.js';
import { mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

// RF-104, RF-106, D-A5 (rotating invalidates the old code at once) and D-A6 (only the administrator sees it), against a real PostGIS.

let app: TestApp;
let fixtures: Fixtures;
let counter = 0;

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

const getCode = (session: Session) => fetch(`${app.baseUrl}/admin/invite-code`, { headers: withSession(session, false) });
const rotate = (session: Session) => fetch(`${app.baseUrl}/admin/invite-code/rotate`, { method: 'POST', headers: { 'content-type': 'application/json', ...withSession(session) }, body: '{}' });
const register = (inviteCode: string) =>
  fetch(`${app.baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `invited-${Date.now()}-${counter++}@example.org`,
      password: 'a-fictitious-password-12',
      passwordConfirm: 'a-fictitious-password-12',
      displayName: 'Fictitious Invitee',
      inviteCode,
      locale: 'es',
    }),
  });
const storedCode = async (org: Org) => (await fixtures.query<{ invite_code: string }>(`SELECT invite_code FROM organizations WHERE id = $1`, [org.orgId]))[0]!.invite_code;

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
}

const READABLE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/;

beforeAll(async () => {
  const { owner, app: connection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: connection, identity: { publicLimits: { register: { max: 10_000, windowSeconds: 600 } } } });
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

describe('the generated code', () => {
  it('has 16 symbols from an alphabet without look-alikes, in groups of four, and does not repeat', () => {
    const codes = Array.from({ length: 200 }, newInviteCode);
    for (const code of codes) {
      expect(code).toMatch(READABLE);
      expect(code.length).toBeGreaterThanOrEqual(10); // the CHECK of organizations.invite_code and the contract
    }
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('getInviteCode (D-A6)', () => {
  it('gives the administrator the code of their organization, valid against the contract, and not cacheable', async () => {
    const org = await organization('CodeGet');
    const response = await getCode(org.session);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = InviteCodeResponse.parse(await response.json());
    expect(body.code).toBe(await storedCode(org));
    const [row] = await fixtures.query<{ rotated_at: Date }>(`SELECT invite_rotated_at AS rotated_at FROM organizations WHERE id = $1`, [org.orgId]);
    expect(new Date(body.rotatedAt).getTime()).toBe(row!.rotated_at.getTime());
  });

  it('is refused to the coordinator and the rescuer with 403, and the code is not in the answer', async () => {
    const org = await organization('CodeRoles');
    const code = await storedCode(org);
    for (const role of ['coordinator', 'rescuer'] as const) {
      const session = await mustLogin(app, org[role].email, TEST_PASSWORD);
      const response = await getCode(session);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(code);
      const rotated = await rotate(session);
      expect(rotated.status).toBe(403);
    }
    expect(await storedCode(org)).toBe(code);
  });

  it("each administrator sees only their own organization's code (INV-01)", async () => {
    const a = await organization('CodeA');
    const b = await organization('CodeB');
    const codeA = InviteCodeResponse.parse(await (await getCode(a.session)).json()).code;
    const codeB = InviteCodeResponse.parse(await (await getCode(b.session)).json()).code;
    expect(codeA).toBe(await storedCode(a));
    expect(codeB).toBe(await storedCode(b));
    expect(codeA).not.toBe(codeB);
    // Rotating B's code leaves A's alone.
    await rotate(b.session);
    expect(await storedCode(a)).toBe(codeA);
    expect(await storedCode(b)).not.toBe(codeB);
  });

  it('the code never appears in the organization, in the sign-up inbox or in the audit log', async () => {
    const org = await organization('CodeLeak');
    const code = await storedCode(org);
    await fixtures.applicant(org.orgId, 'pending');
    const organizationText = await (await fetch(`${app.baseUrl}/org`, { headers: withSession(org.session, false) })).text();
    const inboxText = await (await fetch(`${app.baseUrl}/admin/signup-requests`, { headers: withSession(org.session, false) })).text();
    expect(organizationText).not.toContain(code);
    expect(inboxText).not.toContain(code);
    const rotated = InviteCodeResponse.parse(await (await rotate(org.session)).json());
    const audit = await fixtures.query<{ row: string }>(`SELECT a::text AS row FROM audit_log a WHERE organization_id = $1`, [org.orgId]);
    expect(audit.length).toBeGreaterThan(0);
    for (const { row } of audit) {
      expect(row).not.toContain(code);
      expect(row).not.toContain(rotated.code);
    }
    // The mission history reads audit_log by entity: there is no mission here, so it holds nothing of the code either.
    expect((await fixtures.query(`SELECT 1 FROM audit_log WHERE detail::text LIKE '%' || $1 || '%'`, [rotated.code])).length).toBe(0);
  });
});

describe('rotateInviteCode (D-A5)', () => {
  it('returns a new code, different from the old one, stores it with a fresh date and answers the same from getInviteCode', async () => {
    const org = await organization('Rotate');
    const before = InviteCodeResponse.parse(await (await getCode(org.session)).json());
    await new Promise((resolve) => setTimeout(resolve, 15));
    const response = await rotate(org.session);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const after = InviteCodeResponse.parse(await response.json());
    expect(after.code).toMatch(READABLE);
    expect(after.code).not.toBe(before.code);
    expect(new Date(after.rotatedAt).getTime()).toBeGreaterThan(new Date(before.rotatedAt).getTime());
    expect(await storedCode(org)).toBe(after.code);
    expect(InviteCodeResponse.parse(await (await getCode(org.session)).json())).toEqual(after);
  });

  it('two rotations in a row give two different codes', async () => {
    const org = await organization('RotateTwice');
    const first = InviteCodeResponse.parse(await (await rotate(org.session)).json());
    const second = InviteCodeResponse.parse(await (await rotate(org.session)).json());
    expect(second.code).not.toBe(first.code);
    expect(await storedCode(org)).toBe(second.code);
  });

  it('the old code stops registering at once and the new one registers (REGISTRATION_FAILED is the same answer as any invalid code)', async () => {
    const org = await organization('RotateRegister');
    const old = await storedCode(org);
    expect((await register(old)).status).toBe(202);
    const fresh = InviteCodeResponse.parse(await (await rotate(org.session)).json()).code;
    await expectError(await register(old), 'REGISTRATION_FAILED');
    const accepted = await register(fresh);
    expect(accepted.status).toBe(202);
    // The new applicant is in this organization's inbox.
    const inbox = await (await fetch(`${app.baseUrl}/admin/signup-requests?pageSize=200`, { headers: withSession(org.session, false) })).json();
    expect((inbox as { total: number }).total).toBe(2);
  });

  it('leaves one audit row of invite_code_rotated by the administrator, without the code (and none from a refused call)', async () => {
    const org = await organization('RotateAudit');
    const coordinatorSession = await mustLogin(app, org.coordinator.email, TEST_PASSWORD);
    expect((await rotate(coordinatorSession)).status).toBe(403);
    expect(await fixtures.query(`SELECT 1 FROM audit_log WHERE organization_id = $1 AND action = 'invite_code_rotated'`, [org.orgId])).toEqual([]);
    const oldCode = await storedCode(org);
    const rotated = InviteCodeResponse.parse(await (await rotate(org.session)).json());
    const rows = await fixtures.query<{ entity_type: string; entity_id: string; actor_user_id: string; subject_user_id: string | null; detail: unknown }>(
      `SELECT entity_type, entity_id, actor_user_id, subject_user_id, detail FROM audit_log WHERE organization_id = $1 AND action = 'invite_code_rotated'`,
      [org.orgId],
    );
    expect(rows).toEqual([{ entity_type: 'organization', entity_id: org.orgId, actor_user_id: org.admin.userId, subject_user_id: null, detail: {} }]);
    expect(JSON.stringify(rows)).not.toContain(oldCode);
    expect(JSON.stringify(rows)).not.toContain(rotated.code);
  });

  it("an administrator of another organization cannot rotate this one's code: each call touches only their own", async () => {
    const a = await organization('RotateOwnerA');
    const b = await organization('RotateOwnerB');
    const codeA = await storedCode(a);
    await rotate(b.session);
    expect(await storedCode(a)).toBe(codeA);
    expect((await register(codeA)).status).toBe(202);
  });
});
