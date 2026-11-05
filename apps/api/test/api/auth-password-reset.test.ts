import { createHash } from 'node:crypto';
import { Logger, type LoggerService } from '@nestjs/common';
import { ERROR_HTTP, ErrorDetails, ErrorResponse, Ok } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { FixedClock } from '../support/clock.js';
import { login, mustLogin, startApp, withSession, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD } from '../support/fixtures.js';

// Q-33, migration 0009, H5-acceso P1 and P4: recovering a password with a link sent by mail.

let app: TestApp; // generous limits: most tests ask for many links from one address
let fixtures: Fixtures;
let orgId: string;
let counter = 0;

const NEW_PASSWORD = 'a-brand-new-password-34';
const GENEROUS = { forgotPassword: { max: 10_000, windowSeconds: 3600 }, resetPassword: { max: 10_000, windowSeconds: 3600 } };

// Everything the `api` writes to its log during the tests, to prove that a token never reaches it.
const logged: string[] = [];
const capture: LoggerService = {
  log: (message: unknown, ...rest: unknown[]) => void logged.push([message, ...rest].map(String).join(' ')),
  error: (message: unknown, ...rest: unknown[]) => void logged.push([message, ...rest].map(String).join(' ')),
  warn: (message: unknown, ...rest: unknown[]) => void logged.push([message, ...rest].map(String).join(' ')),
  debug: (message: unknown, ...rest: unknown[]) => void logged.push([message, ...rest].map(String).join(' ')),
  verbose: (message: unknown, ...rest: unknown[]) => void logged.push([message, ...rest].map(String).join(' ')),
};

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection, identity: { publicLimits: GENEROUS } });
  Logger.overrideLogger(capture);
  orgId = await fixtures.organization('PasswordReset');
});

afterAll(async () => {
  Logger.overrideLogger(false);
  await app?.close();
  await fixtures?.close();
});

const active = (role: 'coordinator' | 'rescuer' | 'admin' = 'rescuer', status: 'active' | 'disabled' = 'active') => fixtures.member(orgId, role, status, { password: TEST_PASSWORD });
const post = (target: TestApp, path: string, payload: unknown, headers: Record<string, string> = {}) =>
  fetch(`${target.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
const forgot = (email: string, target: TestApp = app) => post(target, '/auth/password/forgot', { email });
const reset = (token: string, newPassword = NEW_PASSWORD, target: TestApp = app) => post(target, '/auth/password/reset', { token, newPassword });

const tokenOf = (link: string): string => {
  const fragment = new URL(link).hash; // `#token=...`
  expect(fragment.startsWith('#token=')).toBe(true);
  return fragment.slice('#token='.length);
};
const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest();
/** Asks for a link and returns the token the person would read in the mail. */
async function requestLink(email: string, target: TestApp = app): Promise<string> {
  const before = target.mailer.sent.filter((m) => m.to === email).length;
  expect((await forgot(email, target)).status).toBe(202);
  const sent = target.mailer.sent.filter((m) => m.to === email);
  expect(sent.length).toBe(before + 1);
  return tokenOf(sent.at(-1)!.link);
}
const resetRows = (userId: string) =>
  fixtures.query<{ token_hash: Buffer; created_at: Date; expires_at: Date; used_at: Date | null }>(
    `SELECT token_hash, created_at, expires_at, used_at FROM password_resets WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
const shift = (userId: string, minutes: number) =>
  fixtures.query(`UPDATE password_resets SET created_at = created_at - make_interval(mins => $2), expires_at = expires_at - make_interval(mins => $2) WHERE user_id = $1`, [userId, minutes]);

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const parsed = ErrorResponse.parse(await response.json());
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  return parsed;
}
const sameError = (a: ParsedError, b: ParsedError) => expect({ ...a.error, requestId: '' }).toEqual({ ...b.error, requestId: '' });
type ParsedError = ReturnType<typeof ErrorResponse.parse>;

describe('forgotPassword: the answer never tells whether the email has an account (D-A3)', () => {
  it('answers 202 {ok:true} with the same body and headers for an account and for an address nobody has', async () => {
    const member = await active();
    const known = await forgot(member.email);
    const unknown = await forgot(`nobody-${Date.now()}-${counter++}@example.org`);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const [knownBody, unknownBody] = [await known.text(), await unknown.text()];
    expect(Ok.parse(JSON.parse(knownBody))).toEqual({ ok: true });
    expect(knownBody).toBe(unknownBody);

    const headersOf = (response: Response) => Object.fromEntries([...response.headers].filter(([name]) => !['date', 'x-request-id'].includes(name)));
    expect(headersOf(known)).toEqual(headersOf(unknown));
    expect(known.headers.get('cache-control')).toBe('no-store');
    expect(known.headers.get('set-cookie')).toBeNull();
  });

  it('sends exactly ONE mail through the port when the account exists, with the kind, the language of the account and a link with the token in the fragment', async () => {
    const member = await active();
    app.mailer.clear();
    expect((await forgot(member.email.toUpperCase())).status).toBe(202); // the address is read in any case
    expect(app.mailer.sent).toHaveLength(1);
    const [mail] = app.mailer.sent;
    expect(mail).toMatchObject({ to: member.email, kind: 'password-reset', locale: 'es' });
    expect(mail!.link).toMatch(/^http:\/\/localhost:8080\/reset-password#token=[A-Za-z0-9_-]{43}$/);
    expect(new URL(mail!.link).search).toBe(''); // never in the query: the browser does not send the fragment
  });

  it('sends no mail for an address with no account', async () => {
    app.mailer.clear();
    expect((await forgot(`nobody-${Date.now()}-${counter++}@example.org`)).status).toBe(202);
    expect(app.mailer.sent).toHaveLength(0);
  });

  it('writes the mail in the language of the account (users.locale)', async () => {
    const french = await active();
    await fixtures.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [french.userId]);
    const spanish = await active();
    app.mailer.clear();
    await forgot(french.email);
    await forgot(spanish.email);
    expect(app.mailer.lastTo(french.email)?.locale).toBe('fr');
    expect(app.mailer.lastTo(spanish.email)?.locale).toBe('es');
  });

  it('links to the origin the deployment configures (PUBLIC_BASE_URL)', async () => {
    const { app: appConnection } = inject('database');
    const other = await startApp({ database: appConnection, publicBaseUrl: 'https://onway.example.org', identity: { publicLimits: GENEROUS } });
    try {
      const member = await active();
      expect((await forgot(member.email, other)).status).toBe(202);
      expect(other.mailer.lastTo(member.email)?.link).toMatch(/^https:\/\/onway\.example\.org\/reset-password#token=[A-Za-z0-9_-]{43}$/);
    } finally {
      await other.close();
      Logger.overrideLogger(capture); // every app that starts silences the Nest logger; put the capture back
    }
  });

  describe('which accounts get a link: the ones auth_request_password_reset serves', () => {
    const answer = async (email: string) => {
      app.mailer.clear();
      const response = await forgot(email);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
      return app.mailer.sent.length;
    };

    it('an active account does, and so does a PENDING one (it can log in, so it may recover its password)', async () => {
      expect(await answer((await active('coordinator')).email)).toBe(1);
      const applicant = await fixtures.applicant(orgId, 'pending', { password: TEST_PASSWORD });
      expect(await answer(applicant.email)).toBe(1);
    });

    it('a rejected account, a disabled one and an anonymized one do not (the answer is the same 202)', async () => {
      const rejected = await fixtures.applicant(orgId, 'rejected', { password: TEST_PASSWORD });
      const disabled = await active('rescuer', 'disabled');
      const anonymized = await active();
      await fixtures.query(`UPDATE users SET anonymized_at = now() WHERE id = $1`, [anonymized.userId]);
      expect(await answer(rejected.email)).toBe(0);
      expect(await answer(disabled.email)).toBe(0);
      expect(await answer(anonymized.email)).toBe(0);
      for (const member of [rejected, disabled, anonymized]) expect(await resetRows(member.userId)).toHaveLength(0);
    });
  });

  it('at most 3 links per hour and account: the fourth request still answers 202 with the same body and sends nothing more', async () => {
    const member = await active();
    app.mailer.clear();
    const bodies: string[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await forgot(member.email);
      expect(response.status).toBe(202);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(app.mailer.sent).toHaveLength(3);
    expect(await resetRows(member.userId)).toHaveLength(3);

    // An hour later the account can ask again.
    await shift(member.userId, 61);
    app.mailer.clear();
    await forgot(member.email);
    expect(app.mailer.sent).toHaveLength(1);
  });

  it('a body that is not an email or has extra fields is VALIDATION_FAILED and sends nothing', async () => {
    app.mailer.clear();
    await expectError(await post(app, '/auth/password/forgot', { email: 'not-an-email' }), 'VALIDATION_FAILED');
    await expectError(await post(app, '/auth/password/forgot', { email: 'a@example.org', role: 'admin' }), 'VALIDATION_FAILED');
    await expectError(await post(app, '/auth/password/forgot', {}), 'VALIDATION_FAILED');
    expect(app.mailer.sent).toHaveLength(0);
  });

  it('works without a session or a CSRF token, and an open session does not change anything', async () => {
    const member = await active();
    const session = await mustLogin(app, member.email, TEST_PASSWORD);
    app.mailer.clear();
    expect((await post(app, '/auth/password/forgot', { email: member.email }, { cookie: session.cookie })).status).toBe(202);
    expect(app.mailer.sent).toHaveLength(1);
  });

  it('does the same work for an existing address and for a missing one, so the time tells nothing', async () => {
    const member = await active();
    const time = async (email: string) => {
      const start = performance.now();
      await forgot(email);
      return performance.now() - start;
    };
    await time(`warm-up-${Date.now()}@example.org`);
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i++) {
      await shift(member.userId, 61); // keep it under the 3 per hour: every request does the full work
      known.push(await time(member.email));
      unknown.push(await time(`nobody-${Date.now()}-${counter++}@example.org`));
    }
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[2]!;
    // A loose bound: tens of milliseconds of difference would show up if one branch skipped the database call or the token.
    expect(Math.abs(median(known) - median(unknown))).toBeLessThan(75);
  });
});

describe('the token (D-A2): 32 random bytes, and only their SHA-256 reaches the database', () => {
  it('is 43 base64url characters that decode to 32 bytes, different every time', async () => {
    const member = await active();
    const tokens = [await requestLink(member.email), await requestLink(member.email), await requestLink(member.email)];
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
    expect(new Set(tokens).size).toBe(3);
  });

  it('is stored as its SHA-256 only, with an hour to live, and appears in no table and no audit row', async () => {
    const member = await active();
    const token = await requestLink(member.email);
    const [row, ...others] = await resetRows(member.userId);
    expect(others).toHaveLength(0);
    expect(row!.token_hash.equals(sha256(token))).toBe(true);
    expect(row!.used_at).toBeNull();
    expect(row!.expires_at.getTime() - row!.created_at.getTime()).toBe(60 * 60 * 1000);

    expect((await reset(token)).status).toBe(204);

    // Every row of every table in the public schema, as text: neither the token nor the new password is in any of them.
    const tables = await fixtures.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
    expect(tables.length).toBeGreaterThan(20);
    for (const { table_name } of tables) {
      for (const secret of [token, NEW_PASSWORD, Buffer.from(token, 'base64url').toString('hex')]) {
        const hits = await fixtures.query(`SELECT 1 FROM "${table_name}" t WHERE t::text LIKE $1 LIMIT 1`, [`%${secret}%`]);
        expect(hits, `${table_name} holds a secret`).toHaveLength(0);
      }
    }
    const audit = await fixtures.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [member.userId]);
    expect(audit.map((a) => a.action)).toEqual(['password_reset']);
  });

  it('never reaches the log of the api, neither when it is asked for, nor used, nor refused', async () => {
    logged.length = 0;
    const member = await active();
    const token = await requestLink(member.email);
    await reset(token, 'short'); // refused: weak password
    await reset(token); // used
    await reset(token); // used again: refused
    await reset('x'.repeat(30)); // does not exist
    expect(logged.length).toBeGreaterThan(0); // the access log did write
    expect(logged.join('\n')).not.toContain(token);
    expect(logged.join('\n')).not.toContain(NEW_PASSWORD);
  });
});

describe('resetPassword: a valid token', () => {
  it('answers 204 with no body; the new password logs in and the old one does not; the password is an Argon2id hash', async () => {
    const member = await active();
    const token = await requestLink(member.email);
    const response = await reset(token);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull(); // it does not open a session

    expect((await login(app, member.email, NEW_PASSWORD)).response.status).toBe(200);
    await expectError((await login(app, member.email, TEST_PASSWORD)).response, 'INVALID_CREDENTIALS');
    const [user] = await fixtures.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [member.userId]);
    expect(user!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('is used ONCE: the second use of the same token is refused and does not change the password again', async () => {
    const member = await active();
    const token = await requestLink(member.email);
    expect((await reset(token)).status).toBe(204);
    await expectError(await reset(token, 'another-new-password-56'), 'INVALID_RESET_TOKEN');
    expect((await login(app, member.email, NEW_PASSWORD)).response.status).toBe(200);
    expect((await login(app, member.email, 'another-new-password-56')).response.status).toBe(401);
    expect((await resetRows(member.userId)).every((r) => r.used_at !== null)).toBe(true);
  });

  it('using one voids the other links still pending for that person', async () => {
    const member = await active();
    const first = await requestLink(member.email);
    const second = await requestLink(member.email);
    expect((await reset(second)).status).toBe(204);
    await expectError(await reset(first), 'INVALID_RESET_TOKEN');
  });

  it('expires after an hour: it works until then and not after (the hour is the database clock, shifted here)', async () => {
    const before = await active();
    const tokenBefore = await requestLink(before.email);
    await shift(before.userId, 59);
    expect((await reset(tokenBefore)).status).toBe(204);

    const after = await active();
    const tokenAfter = await requestLink(after.email);
    await shift(after.userId, 61);
    await expectError(await reset(tokenAfter), 'INVALID_RESET_TOKEN');
    expect((await login(app, after.email, TEST_PASSWORD)).response.status).toBe(200); // the password did not change
  });

  it("closes ALL the sessions of the account, and no one else's", async () => {
    const member = await active('coordinator');
    const other = await active('coordinator');
    const [first, second, bystander] = [await mustLogin(app, member.email, TEST_PASSWORD), await mustLogin(app, member.email, TEST_PASSWORD), await mustLogin(app, other.email, TEST_PASSWORD)];
    for (const session of [first, second]) expect((await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) })).status).toBe(200);

    expect((await reset(await requestLink(member.email))).status).toBe(204);

    for (const session of [first, second]) {
      const gone = ErrorResponse.parse(await (await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) })).json());
      expect(['UNAUTHENTICATED', 'SESSION_EXPIRED']).toContain(gone.error.code);
    }
    expect((await fetch(`${app.baseUrl}/auth/me`, { headers: withSession(bystander, false) })).status).toBe(200);
    expect(await fixtures.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [member.userId])).toHaveLength(0);
  });

  it('lifts the lock for too many failed attempts: a locked account logs in with the new password', async () => {
    const member = await active();
    for (let i = 1; i <= 4; i++) await expectError((await login(app, member.email, 'a-wrong-password-1')).response, 'INVALID_CREDENTIALS');
    await expectError((await login(app, member.email, 'a-wrong-password-1')).response, 'ACCOUNT_LOCKED');
    await expectError((await login(app, member.email, TEST_PASSWORD)).response, 'ACCOUNT_LOCKED');

    // A locked account can still ask for a link and use it: that is the way out.
    expect((await reset(await requestLink(member.email))).status).toBe(204);
    expect((await login(app, member.email, NEW_PASSWORD)).response.status).toBe(200);
    const [user] = await fixtures.query<{ failed_logins: number; locked_until: Date | null }>(`SELECT failed_logins, locked_until FROM users WHERE id = $1`, [member.userId]);
    expect(user).toMatchObject({ failed_logins: 0, locked_until: null });
  });

  it('leaves one audit row password_reset (the function writes it) for a member, with the person as actor and subject', async () => {
    const member = await active('coordinator');
    expect((await reset(await requestLink(member.email))).status).toBe(204);
    const audit = await fixtures.query<{ organization_id: string; entity_type: string; action: string; actor_user_id: string; subject_user_id: string }>(
      `SELECT organization_id, entity_type, action, actor_user_id, subject_user_id FROM audit_log WHERE entity_id = $1`,
      [member.userId],
    );
    expect(audit).toEqual([{ organization_id: orgId, entity_type: 'user', action: 'password_reset', actor_user_id: member.userId, subject_user_id: member.userId }]);
  });

  it('a PENDING account recovers its password too (it has no organization yet, so there is no audit row) and still lands on the waiting screen', async () => {
    const applicant = await fixtures.applicant(orgId, 'pending', { password: TEST_PASSWORD });
    expect((await reset(await requestLink(applicant.email))).status).toBe(204);
    const { response, session } = await login(app, applicant.email, NEW_PASSWORD);
    expect(response.status).toBe(200);
    expect((session!.body.user as { nextStep: string }).nextStep).toBe('awaiting-approval');
    expect(await fixtures.query(`SELECT 1 FROM audit_log WHERE entity_id = $1`, [applicant.userId])).toHaveLength(0);
  });

  it('works without a session or a CSRF token', async () => {
    const member = await active();
    const token = await requestLink(member.email);
    expect((await post(app, '/auth/password/reset', { token, newPassword: NEW_PASSWORD })).status).toBe(204);
  });
});

describe('resetPassword: a token that does not work always says the same thing (INVALID_RESET_TOKEN)', () => {
  it('a token that never existed, an empty one, a short one, an overlong one, one with strange characters, a used one, an expired one and one of a disabled account give the very same 422', async () => {
    const used = await active();
    const usedToken = await requestLink(used.email);
    await reset(usedToken);

    const expired = await active();
    const expiredToken = await requestLink(expired.email);
    await shift(expired.userId, 61);

    const disabled = await active();
    const disabledToken = await requestLink(disabled.email);
    await fixtures.query(`UPDATE users SET account_status = 'disabled' WHERE id = $1`, [disabled.userId]);

    const anonymized = await active();
    const anonymizedToken = await requestLink(anonymized.email);
    await fixtures.query(`UPDATE users SET anonymized_at = now() WHERE id = $1`, [anonymized.userId]);

    const tokens = {
      neverExisted: Buffer.alloc(32, 7).toString('base64url'),
      empty: '',
      short: 'abc',
      twentyChars: 'a'.repeat(20),
      overlong: 'a'.repeat(5000),
      strange: 'ñ/../%00 <script>\n',
      used: usedToken,
      expired: expiredToken,
      disabledAccount: disabledToken,
      anonymizedAccount: anonymizedToken,
    };
    const answers = await Promise.all(Object.entries(tokens).map(async ([name, token]) => [name, await reset(token)] as const));
    const parsed: ParsedError[] = [];
    for (const [, response] of answers) {
      parsed.push(await expectError(response, 'INVALID_RESET_TOKEN'));
      expect(response.status).toBe(422);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    for (const p of parsed) sameError(p, parsed[0]!);
    expect(parsed[0]!.error.details).toBeUndefined();

    // None of them changed anything.
    await expectError((await login(app, disabled.email, TEST_PASSWORD)).response, 'ACCOUNT_DISABLED');
    expect((await login(app, expired.email, TEST_PASSWORD)).response.status).toBe(200);
  });

  it('a token of the wrong type is a malformed request, not a token problem', async () => {
    await expectError(await post(app, '/auth/password/reset', { token: 12345, newPassword: NEW_PASSWORD }), 'VALIDATION_FAILED');
    await expectError(await post(app, '/auth/password/reset', { newPassword: NEW_PASSWORD }), 'VALIDATION_FAILED');
    await expectError(await post(app, '/auth/password/reset', { token: 'a'.repeat(43), newPassword: NEW_PASSWORD, role: 'admin' }), 'VALIDATION_FAILED');
  });
});

describe('resetPassword: the new password has the rule of the registration', () => {
  const weak: [string, string][] = [
    ['shorter than the minimum', 'short-pw-1'],
    ['empty', ''],
    ['over 200 characters', 'x'.repeat(201)],
  ];
  it.each(weak)('a password %s is VALIDATION_FAILED, without echoing it, and the token is NOT consumed', async (_name, password) => {
    const member = await active();
    const token = await requestLink(member.email);
    const error = await expectError(await reset(token, password), 'VALIDATION_FAILED');
    expect(JSON.stringify(error)).not.toContain(password || '\u0000');
    expect((await resetRows(member.userId))[0]!.used_at).toBeNull();
    expect((await login(app, member.email, TEST_PASSWORD)).response.status).toBe(200); // nothing changed
    expect((await reset(token)).status).toBe(204); // and the same link still works with a good password
  });

  it('a weak password with a token that does not exist is VALIDATION_FAILED too: it says nothing about the token', async () => {
    await expectError(await reset('a'.repeat(43), 'short-pw-1'), 'VALIDATION_FAILED');
  });
});

describe('the Mailer fails', () => {
  it('forgotPassword still answers the very same 202, the failure is logged without the token, and the person can ask again', async () => {
    const member = await active();
    const unknown = await forgot(`nobody-${Date.now()}-${counter++}@example.org`);
    const reference = await unknown.text();

    const sent: string[] = [];
    const original = app.mailer.send.bind(app.mailer);
    app.mailer.send = async (message) => {
      sent.push(message.link);
      throw new Error(`smtp down while sending ${message.link}`);
    };
    logged.length = 0;
    try {
      const response = await forgot(member.email);
      expect(response.status).toBe(202);
      expect(await response.text()).toBe(reference);
      await vi.waitFor(() => expect(logged.some((line) => line.includes('password-reset mail could not be sent'))).toBe(true));
    } finally {
      app.mailer.send = original;
    }
    const token = tokenOf(sent[0]!);
    expect(logged.join('\n')).not.toContain(token); // not even when the error of the adapter quotes the link
    expect(logged.join('\n')).not.toContain(member.email);

    // The row exists (the function wrote it before the mail), nobody holds the token, and it counts for the 3 per hour.
    expect(await resetRows(member.userId)).toHaveLength(1);
    app.mailer.clear();
    expect(await requestLink(member.email)).not.toBe(token);
  });

  it('a mailer that throws before returning a promise is handled the same way', async () => {
    const member = await active();
    const original = app.mailer.send.bind(app.mailer);
    app.mailer.send = () => {
      throw new Error('sync failure');
    };
    try {
      expect((await forgot(member.email)).status).toBe(202);
    } finally {
      app.mailer.send = original;
    }
    expect((await forgot(member.email)).status).toBe(202); // the api is alive
  });
});

describe('P4: the same limiter as the registration, per IP and operation', () => {
  const small = { forgotPassword: { max: 2, windowSeconds: 3600 }, resetPassword: { max: 2, windowSeconds: 3600 } };
  let clock: FixedClock;
  let limited: TestApp;

  beforeAll(async () => {
    const { app: appConnection } = inject('database');
    clock = new FixedClock(new Date('2026-11-05T10:00:00Z'));
    limited = await startApp({ database: appConnection, clock, identity: { publicLimits: small } });
    Logger.overrideLogger(capture);
  });
  afterAll(async () => {
    await limited?.close();
  });

  it('forgotPassword answers 429 RATE_LIMITED with retryAfterSeconds once the window is full, sends nothing then, and lets the client in later', async () => {
    const member = await active();
    const mails = () => limited.mailer.sent.filter((m) => m.to === member.email).length;
    expect((await forgot(member.email, limited)).status).toBe(202);
    expect((await forgot(`nobody-${counter++}@example.org`, limited)).status).toBe(202); // an address with no account counts as much
    const refused = await forgot(member.email, limited);
    const error = await expectError(refused, 'RATE_LIMITED');
    expect(ErrorDetails.RATE_LIMITED.parse(error.error.details).retryAfterSeconds).toBe(3600);
    expect(mails()).toBe(1);
    expect(await resetRows(member.userId)).toHaveLength(1); // the refused request did not even reach the database

    clock.advance(3_600_000);
    expect((await forgot(member.email, limited)).status).toBe(202);
    expect(mails()).toBe(2);
  });

  it('resetPassword counts every request, valid or not, and a refused one does not consume the token; each operation has its own count', async () => {
    clock.advance(2 * 3_600_000);
    const member = await active();
    const token = await requestLink(member.email, limited);
    clock.advance(3_600_000); // reset window is empty again
    await expectError(await reset('a'.repeat(43), NEW_PASSWORD, limited), 'INVALID_RESET_TOKEN');
    await expectError(await reset('b'.repeat(43), NEW_PASSWORD, limited), 'INVALID_RESET_TOKEN');
    const refused = await expectError(await reset(token, NEW_PASSWORD, limited), 'RATE_LIMITED');
    expect(ErrorDetails.RATE_LIMITED.parse(refused.error.details).retryAfterSeconds).toBeGreaterThan(0);
    expect((await resetRows(member.userId))[0]!.used_at).toBeNull();
    expect((await login(limited, member.email, TEST_PASSWORD)).response.status).toBe(200);

    clock.advance(3_600_000);
    expect((await reset(token, NEW_PASSWORD, limited)).status).toBe(204);
  });
});
