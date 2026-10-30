import { createHash } from 'node:crypto';
import { ERROR_HTTP, ErrorDetails, ErrorResponse, LoginResponse, MeResponse } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { csrfTokenFor } from '../../src/common/csrf.js';
import { DatabaseService } from '../../src/db/database.service.js';
import { FixedClock } from '../support/clock.js';
import { login, mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';
import { TestOnlyController } from '../support/test-controllers.js';

let app: TestApp; // system clock
let timed: TestApp; // fixed clock: lockout and session expiry
let clock: FixedClock;
let fixtures: Fixtures;
let database: DatabaseService;
let orgId: string;

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  clock = new FixedClock(new Date());
  app = await startApp({ database: appConnection, extraControllers: [TestOnlyController] });
  timed = await startApp({ database: appConnection, clock });
  database = app.app.get(DatabaseService);
  orgId = await fixtures.organization('Auth');
});

afterAll(async () => {
  await app?.close();
  await timed?.close();
  await fixtures?.close();
});

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed;
}

const active = (role: 'admin' | 'coordinator' | 'rescuer', profile: 'incomplete' | 'complete' = 'incomplete') => fixtures.member(orgId, role, 'active', { password: TEST_PASSWORD, profile });
const logout = (target: TestApp, session: Session, headers = withSession(session)) => fetch(`${target.baseUrl}/auth/logout`, { method: 'POST', headers });
const me = (target: TestApp, session: Session) => fetch(`${target.baseUrl}/auth/me`, { headers: withSession(session, false) });

describe('RF-101: login', () => {
  it('opens a session: 200, body valid against its schema, cookie and CSRF token', async () => {
    const member = await active('coordinator');
    const { response, session } = await login(app, member.email, TEST_PASSWORD);
    expect(response.status).toBe(200);
    const body = LoginResponse.parse(await response.json());
    expect(body.user).toMatchObject({ id: member.userId, email: member.email, role: 'coordinator', accountStatus: 'active', organization: { id: orgId }, profileStatus: null, nextStep: 'home' });
    expect(body.csrfToken).toBe(session!.csrf);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(body)).not.toMatch(/argon2|password/i);
  });

  it('accepts the email in any case', async () => {
    const member = await active('rescuer');
    expect((await login(app, member.email.toUpperCase(), TEST_PASSWORD)).response.status).toBe(200);
  });

  it('sets the cookie with HttpOnly, Secure and SameSite=Strict (AC-04), a 256-bit token stored only as a hash', async () => {
    const member = await active('admin');
    const { session } = await login(app, member.email, TEST_PASSWORD);
    const attributes = session!.setCookie.split('; ');
    expect(attributes[0]).toMatch(/^onway_session=[A-Za-z0-9_-]{43}$/);
    expect(attributes.slice(1)).toEqual(['Max-Age=43200', 'Path=/api', 'HttpOnly', 'Secure', 'SameSite=Strict']);

    const token = session!.cookie.split('=')[1]!;
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const rows = await fixtures.query<{ id: Buffer; expires_at: Date; user_agent: string | null }>(`SELECT id, expires_at, user_agent FROM sessions WHERE user_id = $1`, [member.userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(rows[0]!.id.equals(Buffer.from(token, 'base64url'))).toBe(false); // the raw token is not what is stored
    expect(session!.csrf).toBe(csrfTokenFor(app.identity.csrfSecret, token));
  });

  it('a wrong password and an email that does not exist give the very same 401 INVALID_CREDENTIALS', async () => {
    const member = await active('rescuer');
    const wrong = await login(app, member.email, 'a-wrong-password-1');
    const unknown = await login(app, 'nobody-here@example.org', 'a-wrong-password-1');
    expect(wrong.response.status).toBe(401);
    expect(unknown.response.status).toBe(401);
    const a = await expectError(wrong.response, 'INVALID_CREDENTIALS');
    const b = await expectError(unknown.response, 'INVALID_CREDENTIALS');
    expect({ ...a.error, requestId: '' }).toEqual({ ...b.error, requestId: '' }); // same code, same message, no details
    expect(JSON.stringify([a, b])).not.toContain('a-wrong-password-1');
    expect(wrong.response.headers.get('set-cookie')).toBeNull();
    expect(await fixtures.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [member.userId])).toHaveLength(0);
  });

  it('an unknown email pays for a full Argon2id verification, like a wrong password (no timing shortcut)', async () => {
    const member = await active('rescuer');
    const time = async (email: string) => {
      const start = performance.now();
      await login(app, email, 'a-wrong-password-1');
      return performance.now() - start;
    };
    await time(member.email); // warm up
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i++) {
      known.push(await time(member.email));
      unknown.push(await time(`nobody-${i}@example.org`));
    }
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[2]!;
    // Hashing costs tens of milliseconds; skipping it would be an order of magnitude faster.
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.5);
  });

  it('five failures lock the account: 423 ACCOUNT_LOCKED with retryAfterSeconds, even with the right password (fixed clock)', async () => {
    // The lock is stamped by the database clock (`now()` in auth_record_attempt); line the fixed clock up with it.
    clock.set(new Date());
    const member = await active('rescuer');
    const other = await active('rescuer');
    for (let i = 1; i <= 4; i++) {
      await expectError((await login(timed, member.email, 'a-wrong-password-1')).response, 'INVALID_CREDENTIALS');
    }
    const fifth = await expectError((await login(timed, member.email, 'a-wrong-password-1')).response, 'ACCOUNT_LOCKED');
    const details = ErrorDetails.ACCOUNT_LOCKED.parse(fifth.error.details);
    expect(details.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(details.retryAfterSeconds).toBeLessThanOrEqual(15 * 60 + 5); // a few seconds of skew between both clocks

    const correct = await expectError((await login(timed, member.email, TEST_PASSWORD)).response, 'ACCOUNT_LOCKED');
    expect(ErrorDetails.ACCOUNT_LOCKED.parse(correct.error.details).retryAfterSeconds).toBeLessThanOrEqual(details.retryAfterSeconds);
    expect(await fixtures.query(`SELECT 1 FROM users WHERE id = $1 AND failed_logins = 5`, [member.userId])).toHaveLength(1); // attempts while locked are not counted
    expect((await login(timed, other.email, TEST_PASSWORD)).response.status).toBe(200); // another account is not affected

    clock.advance(14 * 60_000);
    const later = await expectError((await login(timed, member.email, TEST_PASSWORD)).response, 'ACCOUNT_LOCKED');
    expect(ErrorDetails.ACCOUNT_LOCKED.parse(later.error.details).retryAfterSeconds).toBeLessThan(120);

    clock.advance(2 * 60_000); // past the lock
    expect((await login(timed, member.email, TEST_PASSWORD)).response.status).toBe(200);
    const [row] = await fixtures.query<{ failed_logins: number; locked_until: Date | null }>(`SELECT failed_logins, locked_until FROM users WHERE id = $1`, [member.userId]);
    expect(row).toEqual({ failed_logins: 0, locked_until: null });
  });

  it('a successful login before the limit resets the count', async () => {
    const member = await active('rescuer');
    for (let i = 0; i < 4; i++) await login(app, member.email, 'a-wrong-password-1');
    expect((await login(app, member.email, TEST_PASSWORD)).response.status).toBe(200);
    for (let i = 0; i < 4; i++) await expectError((await login(app, member.email, 'a-wrong-password-1')).response, 'INVALID_CREDENTIALS');
  });
});

describe('getMe and the life of a session (D-H0-07)', () => {
  it('no cookie → 401 UNAUTHENTICATED; a malformed or unknown token too', async () => {
    await expectError(await fetch(`${app.baseUrl}/auth/me`), 'UNAUTHENTICATED');
    await expectError(await fetch(`${app.baseUrl}/auth/me`, { headers: { cookie: 'onway_session=short' } }), 'UNAUTHENTICATED');
    await expectError(await fetch(`${app.baseUrl}/auth/me`, { headers: { cookie: `onway_session=${'A'.repeat(43)}` } }), 'UNAUTHENTICATED');
    await expectError(await fetch(`${app.baseUrl}/auth/me`, { headers: { cookie: 'other=1' } }), 'UNAUTHENTICATED');
  });

  it('with a session → 200, valid against its schema, the same CSRF token as login; a GET needs no CSRF header', async () => {
    const member = await active('rescuer', 'complete');
    const session = await mustLogin(app, member.email, TEST_PASSWORD);
    const response = await me(app, session);
    expect(response.status).toBe(200);
    const body = MeResponse.parse(await response.json());
    expect(body.csrfToken).toBe(session.csrf);
    expect(body.user).toMatchObject({ id: member.userId, role: 'rescuer', profileStatus: 'complete', nextStep: 'home' });
  });

  it('an expired session → 401 SESSION_EXPIRED (fixed clock)', async () => {
    const member = await active('coordinator');
    const session = await mustLogin(timed, member.email, TEST_PASSWORD);
    expect((await me(timed, session)).status).toBe(200);
    clock.advance(12 * 3_600_000 - 1_000);
    expect((await me(timed, session)).status).toBe(200);
    clock.advance(2_000);
    await expectError(await me(timed, session), 'SESSION_EXPIRED');
  });

  it('every login is a new session; one session does not open the door of another user', async () => {
    const a = await active('rescuer');
    const b = await active('coordinator');
    const first = await mustLogin(app, a.email, TEST_PASSWORD);
    const second = await mustLogin(app, a.email, TEST_PASSWORD);
    expect(first.cookie).not.toBe(second.cookie);
    const other = await mustLogin(app, b.email, TEST_PASSWORD);
    expect(((await (await me(app, other)).json()) as { user: { id: string } }).user.id).toBe(b.userId);
  });
});

describe('CSRF and logout (D-H0-08, AC-04)', () => {
  it('logout without X-CSRF-Token → 403 CSRF_FAILED and the session still stands', async () => {
    const member = await active('coordinator');
    const session = await mustLogin(app, member.email, TEST_PASSWORD);
    await expectError(await logout(app, session, withSession(session, false)), 'CSRF_FAILED');
    expect((await me(app, session)).status).toBe(200);
  });

  it('a wrong token, or the token of another session, is refused', async () => {
    const a = await mustLogin(app, (await active('coordinator')).email, TEST_PASSWORD);
    const b = await mustLogin(app, (await active('coordinator')).email, TEST_PASSWORD);
    await expectError(await logout(app, a, { cookie: a.cookie, 'x-csrf-token': 'x'.repeat(43) }), 'CSRF_FAILED');
    await expectError(await logout(app, a, { cookie: a.cookie, 'x-csrf-token': b.csrf }), 'CSRF_FAILED');
    await expectError(await fetch(`${app.baseUrl}/test-only/write`, { method: 'POST', headers: { cookie: a.cookie } }), 'CSRF_FAILED');
    expect((await fetch(`${app.baseUrl}/test-only/write`, { method: 'POST', headers: withSession(a) })).status).toBe(200);
  });

  it('with the token → 204, the cookie is cleared and the session stops being valid', async () => {
    const member = await active('rescuer');
    const session = await mustLogin(app, member.email, TEST_PASSWORD);
    const other = await mustLogin(app, member.email, TEST_PASSWORD);
    const response = await logout(app, session);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.getSetCookie()[0]).toBe('onway_session=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict');
    await expectError(await me(app, session), 'UNAUTHENTICATED');
    await expectError(await logout(app, session), 'UNAUTHENTICATED');
    expect((await me(app, other)).status).toBe(200); // the other session of the same user is untouched
    expect(await fixtures.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [member.userId])).toHaveLength(1);
  });

  it('login needs no CSRF token (there is no session yet)', async () => {
    const member = await active('rescuer');
    expect((await login(app, member.email, TEST_PASSWORD)).response.status).toBe(200);
  });
});

describe('INV-25: account state through the API', () => {
  const statusOf = async (member: Member) => (await fixtures.query<{ account_status: string }>(`SELECT account_status FROM users WHERE id = $1`, [member.userId]))[0]!.account_status;

  it('pending: login 200 awaiting-approval, getMe 200, no organization and no role', async () => {
    const pending = await fixtures.applicant(orgId, 'pending', { password: TEST_PASSWORD });
    const { response, session } = await login(app, pending.email, TEST_PASSWORD);
    expect(response.status).toBe(200);
    const body = LoginResponse.parse(session!.body);
    expect(body.user).toMatchObject({ accountStatus: 'pending', organization: null, role: null, profileStatus: null, nextStep: 'awaiting-approval' });
    const mine = MeResponse.parse(await (await me(app, session!)).json());
    expect(mine.user).toEqual(body.user);
  });

  it('pending: nothing else is reachable (403 ACCOUNT_PENDING) and its transaction sees no organization data', async () => {
    const staff = await active('coordinator');
    const pending = await fixtures.applicant(orgId, 'pending', { password: TEST_PASSWORD });
    const session = await mustLogin(app, pending.email, TEST_PASSWORD);
    await expectError(await fetch(`${app.baseUrl}/test-only/staff`, { headers: withSession(session, false) }), 'ACCOUNT_PENDING');
    await expectError(await fetch(`${app.baseUrl}/test-only/write`, { method: 'POST', headers: withSession(session) }), 'ACCOUNT_PENDING');
    const probe = await fetch(`${app.baseUrl}/test-only/context`, { headers: withSession(session, false) });
    expect(await probe.json()).toEqual({ orgId: null, userId: pending.userId, role: null, visibleMemberships: 0, visibleUsers: 1 });
    void staff;
    expect((await logout(app, session)).status).toBe(204); // it can leave
  });

  it('rejected: login 403 ACCOUNT_REJECTED; a wrong password still gives INVALID_CREDENTIALS (no probing)', async () => {
    const rejected = await fixtures.applicant(orgId, 'rejected', { password: TEST_PASSWORD });
    await expectError((await login(app, rejected.email, TEST_PASSWORD)).response, 'ACCOUNT_REJECTED');
    await expectError((await login(app, rejected.email, 'a-wrong-password-1')).response, 'INVALID_CREDENTIALS');
    expect(await fixtures.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [rejected.userId])).toHaveLength(0);
  });

  it('disabled: login 403 ACCOUNT_DISABLED; a wrong password still gives INVALID_CREDENTIALS', async () => {
    const disabled = await fixtures.member(orgId, 'rescuer', 'disabled', { password: TEST_PASSWORD });
    await expectError((await login(app, disabled.email, TEST_PASSWORD)).response, 'ACCOUNT_DISABLED');
    await expectError((await login(app, disabled.email, 'a-wrong-password-1')).response, 'INVALID_CREDENTIALS');
  });

  it('deactivating an account with an open session (admin_set_account_status) → its next getMe is 401; reactivating lets it in again', async () => {
    const admin = await active('admin');
    const victim = await active('rescuer');
    const session = await mustLogin(app, victim.email, TEST_PASSWORD);
    const adminSession = await mustLogin(app, admin.email, TEST_PASSWORD);
    expect((await me(app, session)).status).toBe(200);

    const setStatus = (status: 'disabled' | 'active') =>
      database.withContext({ orgId, userId: admin.userId, role: 'admin' }, (tx) => tx.execute(sql`SELECT admin_set_account_status(${victim.userId}::uuid, ${status}::account_status)`));
    await setStatus('disabled');
    await expectError(await me(app, session), 'UNAUTHENTICATED');
    await expectError((await login(app, victim.email, TEST_PASSWORD)).response, 'ACCOUNT_DISABLED');
    expect((await me(app, adminSession)).status).toBe(200);

    await setStatus('active');
    expect((await login(app, victim.email, TEST_PASSWORD)).response.status).toBe(200);
    expect(await statusOf(victim)).toBe('active');
  });

  it('the state is read on every request: a session that survives its account’s change of state is refused', async () => {
    const disabledLater = await active('coordinator');
    const session = await mustLogin(app, disabledLater.email, TEST_PASSWORD);
    await fixtures.query(`UPDATE memberships SET status = 'disabled' WHERE user_id = $1`, [disabledLater.userId]);
    await expectError(await me(app, session), 'ACCOUNT_DISABLED'); // an active account that lost its membership

    const pending = await fixtures.applicant(orgId, 'pending', { password: TEST_PASSWORD });
    const pendingSession = await mustLogin(app, pending.email, TEST_PASSWORD);
    await fixtures.query(`UPDATE users SET account_status = 'rejected' WHERE id = $1`, [pending.userId]);
    await expectError(await me(app, pendingSession), 'ACCOUNT_REJECTED');
  });
});

describe('RF-102: the role comes from the membership; RF-103: permissions are decided by the server', () => {
  it('login and getMe report the role and organization of the membership, with the right nextStep', async () => {
    const cases = [
      { member: await active('admin'), role: 'admin', nextStep: 'home', profileStatus: null },
      { member: await active('coordinator'), role: 'coordinator', nextStep: 'home', profileStatus: null },
      { member: await active('rescuer', 'incomplete'), role: 'rescuer', nextStep: 'complete-profile', profileStatus: 'incomplete' },
      { member: await active('rescuer', 'complete'), role: 'rescuer', nextStep: 'home', profileStatus: 'complete' },
    ];
    for (const { member, role, nextStep, profileStatus } of cases) {
      const session = await mustLogin(app, member.email, TEST_PASSWORD);
      const body = MeResponse.parse(await (await me(app, session)).json());
      expect(body.user).toMatchObject({ role, nextStep, profileStatus, organization: { id: orgId } });
      expect(session.body.user).toMatchObject({ role, nextStep });
    }
  });

  it('a client cannot choose its role or organization: unknown fields in the login body are refused', async () => {
    const member = await active('rescuer');
    const response = await fetch(`${app.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: member.email, password: TEST_PASSWORD, role: 'admin', organizationId: orgId }),
    });
    await expectError(response, 'VALIDATION_FAILED');
  });

  it('a staff-only route (test controller): rescuer → 403 FORBIDDEN; coordinator and administrator → 200; no session → 401', async () => {
    const rescuer = await mustLogin(app, (await active('rescuer')).email, TEST_PASSWORD);
    const coordinator = await mustLogin(app, (await active('coordinator')).email, TEST_PASSWORD);
    const admin = await mustLogin(app, (await active('admin')).email, TEST_PASSWORD);
    const call = (session?: Session) => fetch(`${app.baseUrl}/test-only/staff`, { headers: session ? withSession(session, false) : {} });
    await expectError(await call(rescuer), 'FORBIDDEN');
    expect((await call(coordinator)).status).toBe(200);
    expect((await call(admin)).status).toBe(200);
    await expectError(await call(), 'UNAUTHENTICATED');
  });
});
