// Cuenta propia (H5-perfil T5): updateMe (RF-102, D-P6) y changePassword (D-P5). Datos ficticios (regla 10).
import { ErrorResponse, MeResponse } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { login, mustLogin, startApp, withSession, type Session, type TestApp } from '../support/app.js';
import { Fixtures, TEST_PASSWORD, type Member } from '../support/fixtures.js';

let app: TestApp;
let fixtures: Fixtures;
let orgId: string;

const NEW_PASSWORD = 'otra-contraseña-ficticia-2';

beforeAll(async () => {
  const { owner, app: appConnection } = inject('database');
  fixtures = new Fixtures(owner);
  app = await startApp({ database: appConnection });
  orgId = await fixtures.organization('Account');
});

afterAll(async () => {
  await app?.close();
  await fixtures?.close();
});

const member = (role: 'admin' | 'coordinator' | 'rescuer' = 'coordinator') => fixtures.member(orgId, role, 'active', { password: TEST_PASSWORD });
const send = (session: Session, method: string, path: string, body: unknown) =>
  fetch(`${app.baseUrl}${path}`, { method, headers: { ...withSession(session), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getMe = (session: Session) => fetch(`${app.baseUrl}/auth/me`, { headers: withSession(session, false) });

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = ErrorResponse.parse(await response.json());
  expect(body.error.code).toBe(code);
  return body;
}

describe('updateMe (RF-102, D-P6)', () => {
  it('changes the visible name and the language of the account, and answers the session user', async () => {
    const person = await member();
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    const response = await send(session, 'PATCH', '/auth/me', { displayName: 'Nombre Visible Nuevo', locale: 'fr' });
    expect(response.status).toBe(200);
    const body = MeResponse.parse(await response.json());
    expect(body.user).toMatchObject({ displayName: 'Nombre Visible Nuevo', locale: 'fr', role: 'coordinator' });
    expect(body.csrfToken).toBe(session.csrf);
    const [row] = await fixtures.query<{ display_name: string; locale: string }>(`SELECT display_name, locale FROM users WHERE id = $1`, [person.userId]);
    expect(row).toEqual({ display_name: 'Nombre Visible Nuevo', locale: 'fr' });
  });

  it('nobody changes their own role or email here: the strict body refuses them and nothing changes', async () => {
    const person = await member('rescuer');
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    await expectError(await send(session, 'PATCH', '/auth/me', { role: 'admin' }), 400, 'VALIDATION_FAILED');
    await expectError(await send(session, 'PATCH', '/auth/me', { displayName: 'Otro', email: 'otro@example.org' }), 400, 'VALIDATION_FAILED');
    await expectError(await send(session, 'PATCH', '/auth/me', {}), 400, 'VALIDATION_FAILED');
    const me = MeResponse.parse(await (await getMe(session)).json());
    expect(me.user).toMatchObject({ role: 'rescuer', email: person.email });
  });

  it('needs the CSRF token like every write', async () => {
    const person = await member();
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    const response = await fetch(`${app.baseUrl}/auth/me`, { method: 'PATCH', headers: { ...withSession(session, false), 'content-type': 'application/json' }, body: '{"locale":"fr"}' });
    await expectError(response, 403, 'CSRF_FAILED');
  });
});

describe('changePassword (D-P5)', () => {
  it('keeps the current session, closes the others, and only the new password opens a session', async () => {
    const person = await member('rescuer');
    const current = await mustLogin(app, person.email, TEST_PASSWORD);
    const other = await mustLogin(app, person.email, TEST_PASSWORD);
    expect((await send(current, 'POST', '/auth/password/change', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(204);

    expect((await getMe(current)).status).toBe(200);
    await expectError(await getMe(other), 401, 'UNAUTHENTICATED');
    expect((await login(app, person.email, TEST_PASSWORD)).response.status).toBe(401);
    expect((await login(app, person.email, NEW_PASSWORD)).session).toBeDefined();

    const audit = await fixtures.query<{ action: string; detail: unknown; actor_user_id: string }>(
      `SELECT action, detail, actor_user_id FROM audit_log WHERE action = 'password_changed' AND entity_id = $1`,
      [person.userId],
    );
    expect(audit).toEqual([{ action: 'password_changed', detail: { closedSessions: 1 }, actor_user_id: person.userId }]);
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it('a wrong current password is INVALID_CREDENTIALS, changes nothing and counts as a failed attempt; five of them lock the account', async () => {
    const person = await member();
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    const wrong = { currentPassword: 'no-es-la-contraseña-ficticia', newPassword: NEW_PASSWORD };
    await expectError(await send(session, 'POST', '/auth/password/change', wrong), 401, 'INVALID_CREDENTIALS');
    const [after] = await fixtures.query<{ failed_logins: number }>(`SELECT failed_logins FROM users WHERE id = $1`, [person.userId]);
    expect(after!.failed_logins).toBe(1);
    for (let i = 0; i < 3; i++) await send(session, 'POST', '/auth/password/change', wrong);
    const locked = await expectError(await send(session, 'POST', '/auth/password/change', wrong), 423, 'ACCOUNT_LOCKED');
    expect(locked.error.details).toEqual({ retryAfterSeconds: expect.any(Number) });
    // Bloqueada: ni siquiera la contraseña correcta cambia nada hasta que pase el tiempo.
    await expectError(await send(session, 'POST', '/auth/password/change', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }), 423, 'ACCOUNT_LOCKED');
    expect((await login(app, person.email, NEW_PASSWORD)).response.status).not.toBe(200);
  });

  it('the new password follows the registration rules and must differ from the current one', async () => {
    const person = await member('admin');
    const session = await mustLogin(app, person.email, TEST_PASSWORD);
    await expectError(await send(session, 'POST', '/auth/password/change', { currentPassword: TEST_PASSWORD, newPassword: 'corta' }), 400, 'VALIDATION_FAILED');
    await expectError(await send(session, 'POST', '/auth/password/change', { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }), 400, 'VALIDATION_FAILED');
  });
});

// Una cuenta de cada rol que puede entrar: las tres llegan a estas operaciones.
describe('every active role can use them', () => {
  it('admin, coordinator and rescuer change their name', async () => {
    for (const role of ['admin', 'coordinator', 'rescuer'] as const) {
      const person: Member = await member(role);
      const session = await mustLogin(app, person.email, TEST_PASSWORD);
      expect((await send(session, 'PATCH', '/auth/me', { displayName: `Ficticio ${role}` })).status).toBe(200);
    }
  });
});
