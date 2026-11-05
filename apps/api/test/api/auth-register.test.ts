import { ERROR_HTTP, ErrorDetails, ErrorResponse, LoginResponse, RegisterResponse } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { verifyPassword } from '../../src/identity/password.js';
import { FixedClock } from '../support/clock.js';
import { login, mustLogin, startApp, withSession, type TestApp } from '../support/app.js';
import { Fixtures } from '../support/fixtures.js';
import { TestOnlyController } from '../support/test-controllers.js';

// RF-104, RN-25, INV-25, INV-01 and the limit of public requests (H5-acceso P2, P3, P4).

let app: TestApp; // generous limit: most tests register many times from one address
let fixtures: Fixtures;
let orgA: string;
let orgB: string;
let codeA: string;
let codeB: string;
let counter = 0;

const PASSWORD = 'a-fictitious-password-12';
const newEmail = (prefix = 'newcomer') => `${prefix}-${Date.now()}-${counter++}@example.org`;

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, extraControllers: [TestOnlyController], identity: { publicLimits: { register: { max: 10_000, windowSeconds: 600 } } } });
  orgA = await fixtures.organization('RegisterA');
  orgB = await fixtures.organization('RegisterB');
  codeA = (await fixtures.query<{ invite_code: string }>(`SELECT invite_code FROM organizations WHERE id = $1`, [orgA]))[0]!.invite_code;
  codeB = (await fixtures.query<{ invite_code: string }>(`SELECT invite_code FROM organizations WHERE id = $1`, [orgB]))[0]!.invite_code;
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const body = (overrides: Record<string, unknown> = {}) => {
  const email = newEmail();
  return { email, password: PASSWORD, passwordConfirm: PASSWORD, displayName: 'Fictitious Newcomer', inviteCode: codeA, locale: 'es', ...overrides };
};
const register = (target: TestApp, payload: unknown, headers: Record<string, string> = {}) =>
  fetch(`${target.baseUrl}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
const userRows = (email: string) =>
  fixtures.query<{ id: string; account_status: string; password_hash: string; display_name: string; locale: string }>(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed;
}

describe('RN-25, INV-25: registering never grants access', () => {
  it('answers 202 {status:"received"}, with no session cookie, and leaves a pending account and a pending request', async () => {
    const payload = body();
    const response = await register(app, payload);
    expect(response.status).toBe(202);
    expect(RegisterResponse.parse(await response.json())).toEqual({ status: 'received' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');

    const [user] = await userRows(payload.email);
    expect(user).toMatchObject({ account_status: 'pending', display_name: 'Fictitious Newcomer', locale: 'es' });
    expect(await fixtures.query(`SELECT 1 FROM memberships WHERE user_id = $1`, [user!.id])).toHaveLength(0); // no role, no organization
    expect(await fixtures.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [user!.id])).toHaveLength(0);
    const requests = await fixtures.query<{ organization_id: string; status: string; decided_at: Date | null; granted_role: string | null }>(
      `SELECT organization_id, status, decided_at, granted_role FROM signup_requests WHERE user_id = $1`,
      [user!.id],
    );
    expect(requests).toEqual([{ organization_id: orgA, status: 'pending', decided_at: null, granted_role: null }]);
  });

  it('keeps the language of the person', async () => {
    const payload = body({ locale: 'fr' });
    expect((await register(app, payload)).status).toBe(202);
    expect((await userRows(payload.email))[0]!.locale).toBe('fr');
  });

  it('the new account logs in and is taken to the waiting screen: no organization, no role, nothing of the organization readable', async () => {
    const staff = await fixtures.member(orgA, 'coordinator');
    const payload = body();
    expect((await register(app, payload)).status).toBe(202);

    const { response, session } = await login(app, payload.email, PASSWORD);
    expect(response.status).toBe(200);
    expect(LoginResponse.parse(session!.body).user).toMatchObject({ accountStatus: 'pending', organization: null, role: null, profileStatus: null, nextStep: 'awaiting-approval' });

    const full = await mustLogin(app, payload.email, PASSWORD);
    await expectError(await fetch(`${app.baseUrl}/test-only/staff`, { headers: withSession(full, false) }), 'ACCOUNT_PENDING');
    await expectError(await fetch(`${app.baseUrl}/missions`, { headers: withSession(full, false) }), 'ACCOUNT_PENDING');
    await expectError(await fetch(`${app.baseUrl}/org`, { headers: withSession(full, false) }), 'ACCOUNT_PENDING');
    const probe = await fetch(`${app.baseUrl}/test-only/context`, { headers: withSession(full, false) });
    expect(await probe.json()).toMatchObject({ orgId: null, role: null, visibleMemberships: 0, visibleUsers: 1 });
    void staff;
  });

  it('INV-01: the code of an organization registers in that one and never in another', async () => {
    const forA = body();
    const forB = body({ inviteCode: codeB });
    expect((await register(app, forA)).status).toBe(202);
    expect((await register(app, forB)).status).toBe(202);
    const org = async (email: string) =>
      (await fixtures.query<{ organization_id: string }>(`SELECT s.organization_id FROM signup_requests s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, [email]))[0]?.organization_id;
    expect(await org(forA.email)).toBe(orgA);
    expect(await org(forB.email)).toBe(orgB);
    const [row] = await fixtures.query<{ count: string }>(`SELECT count(*) FROM signup_requests s JOIN users u ON u.id = s.user_id WHERE u.email = $1 AND s.organization_id <> $2`, [forA.email, orgA]);
    expect(row!.count).toBe('0');
  });
});

describe('P3: a refusal never tells why', () => {
  it('an invalid code, a code that belongs to no organization and an email already registered give the very same 422 REGISTRATION_FAILED', async () => {
    const taken = body();
    expect((await register(app, taken)).status).toBe(202);
    const [before] = await userRows(taken.email);

    const attempts = {
      wrongCode: await register(app, body({ inviteCode: 'INV-0000000000000000' })),
      shortOfCode: await register(app, body({ inviteCode: codeA.slice(0, -1) })),
      emailTaken: await register(app, { ...taken, password: 'another-password-12', passwordConfirm: 'another-password-12', displayName: 'Someone Else' }),
      emailTakenOtherCase: await register(app, { ...taken, email: taken.email.toUpperCase(), inviteCode: codeB }),
    };
    const parsed = await Promise.all(Object.values(attempts).map((response) => expectError(response, 'REGISTRATION_FAILED')));
    for (const response of Object.values(attempts)) expect(response.status).toBe(422);
    for (const p of parsed) expect({ ...p.error, requestId: '' }).toEqual({ ...parsed[0]!.error, requestId: '' }); // same code, same message, no details
    expect(parsed[0]!.error.details).toBeUndefined();
    for (const response of Object.values(attempts)) expect(response.headers.get('set-cookie')).toBeNull();

    // The existing account is untouched: same hash, same name, one request, and no other row was created.
    const [after] = await userRows(taken.email);
    expect(after).toEqual(before);
    expect(await fixtures.query(`SELECT 1 FROM signup_requests WHERE user_id = $1`, [before!.id])).toHaveLength(1);
  });

  it('an invalid code creates nothing: no user and no request', async () => {
    const payload = body({ inviteCode: 'INV-ffffffffffffffff' });
    await expectError(await register(app, payload), 'REGISTRATION_FAILED');
    expect(await userRows(payload.email)).toHaveLength(0);
  });

  it('an email that is already registered does not take the time to answer from a shortcut: it pays for the hash like a new one', async () => {
    const taken = body();
    await register(app, taken);
    const time = async (payload: unknown) => {
      const start = performance.now();
      await register(app, payload);
      return performance.now() - start;
    };
    await time(body()); // warm up
    const existing: number[] = [];
    const fresh: number[] = [];
    for (let i = 0; i < 5; i++) {
      existing.push(await time(taken));
      fresh.push(await time(body({ inviteCode: 'INV-0000000000000000' })));
    }
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[2]!;
    expect(median(fresh)).toBeGreaterThan(median(existing) * 0.5);
    expect(median(existing)).toBeGreaterThan(median(fresh) * 0.5);
  });
});

describe('validation: strict schema (VALIDATION_FAILED, nothing created)', () => {
  const cases: [string, (email: string) => Record<string, unknown>][] = [
    ['a password shorter than the minimum', () => ({ password: 'short-pw-1', passwordConfirm: 'short-pw-1' })],
    ['a confirmation that differs', () => ({ passwordConfirm: `${PASSWORD}x` })],
    ['an email that is not an email', () => ({ email: 'not-an-email' })],
    ['an empty name', () => ({ displayName: '   ' })],
    ['a code shorter than 10 characters', () => ({ inviteCode: 'short' })],
    ['a missing code', () => ({ inviteCode: undefined })],
    ['an unknown language', () => ({ locale: 'de' })],
    ['an extra field (a role cannot be asked for)', () => ({ role: 'admin' })],
    ['an extra field (the organization cannot be chosen)', () => ({ organizationId: '00000000-0000-4000-8000-000000000000' })],
  ];
  it.each(cases)('%s', async (_name, change) => {
    const payload = body();
    const response = await register(app, { ...payload, ...change(payload.email) });
    const error = await expectError(response, 'VALIDATION_FAILED');
    expect(JSON.stringify(error)).not.toContain(PASSWORD);
    expect(await userRows(payload.email)).toHaveLength(0);
  });

  it('a body that is not an object, or no body at all', async () => {
    await expectError(await register(app, 'text'), 'VALIDATION_FAILED');
    await expectError(await fetch(`${app.baseUrl}/auth/register`, { method: 'POST' }), 'VALIDATION_FAILED');
  });
});

describe('what is stored', () => {
  it('the password is an Argon2id hash and appears in no table; the email is stored in lower case, as the login reads it; one audit row signup_requested', async () => {
    const mixed = `Mixed.Case-${Date.now()}-${counter++}@Example.ORG`;
    const payload = body({ email: mixed, displayName: 'Fictitious Mixed' });
    expect((await register(app, payload)).status).toBe(202);

    const [user] = await userRows(mixed);
    expect(user).toBeDefined();
    expect(user!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(PASSWORD, user!.password_hash)).toBe(true);
    expect(await verifyPassword('not-the-password-12', user!.password_hash)).toBe(false);

    const dump = await fixtures.query<{ doc: string }>(
      `SELECT row_to_json(u)::text AS doc FROM users u WHERE id = $1
       UNION ALL SELECT row_to_json(s)::text FROM signup_requests s WHERE user_id = $1
       UNION ALL SELECT row_to_json(a)::text FROM audit_log a WHERE actor_user_id = $1 OR entity_id = $1`,
      [user!.id],
    );
    expect(dump.length).toBeGreaterThanOrEqual(3);
    expect(dump.map((row) => row.doc).join('\n')).not.toContain(PASSWORD);

    const audit = await fixtures.query<{ organization_id: string; entity_type: string; action: string; actor_user_id: string }>(
      `SELECT organization_id, entity_type, action, actor_user_id FROM audit_log WHERE entity_id = $1`,
      [user!.id],
    );
    expect(audit).toEqual([{ organization_id: orgA, entity_type: 'signup_request', action: 'signup_requested', actor_user_id: user!.id }]);

    // The login reads the email in any case.
    expect((await login(app, mixed.toUpperCase(), PASSWORD)).response.status).toBe(200);
    // A second registration of the same address in another case is refused like any other repeat.
    await expectError(await register(app, body({ email: mixed.toLowerCase() })), 'REGISTRATION_FAILED');
    expect(await userRows(mixed)).toHaveLength(1);
  });
});

describe('P4: limit of public requests per IP and operation', () => {
  const small = { register: { max: 3, windowSeconds: 600 } };
  const wrongCode = () => body({ inviteCode: 'INV-0000000000000000' }); // counts as much as any other request
  let clock: FixedClock;
  let proxied: TestApp; // behind a proxy it trusts: X-Forwarded-For is read
  let direct: TestApp; // reached without a trusted proxy: X-Forwarded-For is ignored

  beforeAll(async () => {
    const { app: appConnection } = inject('database');
    clock = new FixedClock(new Date('2026-11-05T10:00:00Z'));
    proxied = await startApp({ database: appConnection, clock, trustProxy: 'loopback', identity: { publicLimits: small } });
    direct = await startApp({ database: appConnection, clock, identity: { publicLimits: small } });
  });
  afterAll(async () => {
    await proxied?.close();
    await direct?.close();
  });

  it('answers 429 RATE_LIMITED with retryAfterSeconds once the window is full, and lets the client back in when it passes (fixed clock)', async () => {
    const via = { 'x-forwarded-for': '198.51.100.10' };
    for (let i = 0; i < 3; i++) await expectError(await register(proxied, wrongCode(), via), 'REGISTRATION_FAILED');

    const limited = await register(proxied, body(), via);
    const error = await expectError(limited, 'RATE_LIMITED');
    expect(limited.status).toBe(429);
    const { retryAfterSeconds } = ErrorDetails.RATE_LIMITED.parse(error.error.details);
    expect(retryAfterSeconds).toBe(600);
    expect(limited.headers.get('set-cookie')).toBeNull();

    clock.advance(400_000); // refused requests do not extend the window; the oldest hit leaves 200 s later
    const later = ErrorDetails.RATE_LIMITED.parse((await expectError(await register(proxied, body(), via), 'RATE_LIMITED')).error.details);
    expect(later.retryAfterSeconds).toBe(200);
    clock.advance(200_000);
    expect((await register(proxied, body(), via)).status).toBe(202);
  });

  it('a limited request creates nothing', async () => {
    const via = { 'x-forwarded-for': '198.51.100.11' };
    for (let i = 0; i < 3; i++) await register(proxied, wrongCode(), via);
    const payload = body();
    await expectError(await register(proxied, payload, via), 'RATE_LIMITED');
    expect(await userRows(payload.email)).toHaveLength(0);
  });

  it('behind the trusted proxy each client address has its own count, and a forged address in front of the real one changes nothing', async () => {
    for (let i = 0; i < 3; i++) await register(proxied, wrongCode(), { 'x-forwarded-for': '198.51.100.20' });
    await expectError(await register(proxied, wrongCode(), { 'x-forwarded-for': '198.51.100.20' }), 'RATE_LIMITED');
    await expectError(await register(proxied, wrongCode(), { 'x-forwarded-for': '203.0.113.1, 198.51.100.20' }), 'RATE_LIMITED'); // the client invents the left part
    await expectError(await register(proxied, wrongCode(), { 'x-forwarded-for': '203.0.113.2, 198.51.100.20' }), 'RATE_LIMITED');
    await expectError(await register(proxied, wrongCode(), { 'x-forwarded-for': '198.51.100.21' }), 'REGISTRATION_FAILED'); // another client
  });

  it('a request that does not come through the proxy cannot choose its address with X-Forwarded-For: the header is ignored', async () => {
    // `direct` trusts no proxy: the address is the socket's (127.0.0.1) whatever the header says.
    for (let i = 0; i < 3; i++) await expectError(await register(direct, wrongCode(), { 'x-forwarded-for': `198.51.100.${30 + i}` }), 'REGISTRATION_FAILED');
    await expectError(await register(direct, wrongCode(), { 'x-forwarded-for': '198.51.100.99' }), 'RATE_LIMITED');
    await expectError(await register(direct, wrongCode()), 'RATE_LIMITED'); // with no header it is the same client
  });

  it('a proxy that is not the one trusted is not believed either', async () => {
    const { app: appConnection } = inject('database');
    const elsewhere = await startApp({ database: appConnection, clock, trustProxy: '10.20.30.40', identity: { publicLimits: small } });
    try {
      for (let i = 0; i < 3; i++) await register(elsewhere, wrongCode(), { 'x-forwarded-for': `198.51.100.${40 + i}` });
      await expectError(await register(elsewhere, wrongCode(), { 'x-forwarded-for': '198.51.100.99' }), 'RATE_LIMITED');
    } finally {
      await elsewhere.close();
    }
  });
});
