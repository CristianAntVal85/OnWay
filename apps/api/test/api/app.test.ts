import { ENDPOINTS, ERROR_HTTP, ErrorResponse, MILESTONES } from '@onway/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { nestPath } from '../../src/common/operation.js';
import { Fixtures } from '../support/fixtures.js';
import { mountedRoutes, mustLogin, startApp, withSession, type TestApp } from '../support/app.js';
import { TEST_PASSWORD } from '../support/fixtures.js';
import { TestOnlyController } from '../support/test-controllers.js';

/**
 * Operations built so far: the five of H0 plus those of H1 that earlier tasks have mounted. AC-02 compares the routes
 * Express mounts with this list; each H1 task appends its operations here until T5 leaves exactly the 23 of the milestone.
 */
const BUILT = [
  'getHealth',
  'login',
  'logout',
  'getMe',
  'getOrganization', // H0
  'listCoordinators',
  'listMissions',
  'createMission',
  'getMission',
  'updateMission',
  'listMissionHistory', // H1-T2
];

let real: TestApp;
let stubbed: TestApp;
let fixtures: Fixtures;

beforeAll(async () => {
  const { owner, app } = inject('database');
  fixtures = new Fixtures(owner);
  real = await startApp({ database: app });
  stubbed = await startApp({ database: app, extraControllers: [TestOnlyController] });
});

afterAll(async () => {
  await real?.close();
  await stubbed?.close();
  await fixtures?.close();
});

async function expectError(response: Response, code: keyof typeof ERROR_HTTP) {
  const body = await response.json();
  const parsed = ErrorResponse.parse(body); // AC-05 / AC-16: the single error format, no extra fields
  expect(response.status).toBe(ERROR_HTTP[code]);
  expect(parsed.error.code).toBe(code);
  expect(parsed.error.requestId).toBeTruthy();
  expect(response.headers.get('x-request-id')).toBe(parsed.error.requestId);
  return parsed;
}

describe('routes come from the registry (AC-02, rule 7)', () => {
  it('mounts exactly the operations built so far, and all of them are in the registry', () => {
    const expected = ENDPOINTS.filter((e) => BUILT.includes(e.id)).map((e) => `${e.method} /api/v1${nestPath(e.path)}`);
    expect(expected).toHaveLength(BUILT.length);
    expect(mountedRoutes(real.app)).toEqual(expected.sort());
  });

  it('mounts nothing that belongs to a later milestone than H1, test controllers included', () => {
    const later = ENDPOINTS.filter((e) => MILESTONES.indexOf(e.milestone) > MILESTONES.indexOf('H1')).map((e) => `${e.method} /api/v1${nestPath(e.path)}`);
    const mounted = new Set([...mountedRoutes(real.app), ...mountedRoutes(stubbed.app)]);
    expect(later.length).toBeGreaterThan(70);
    expect(later.filter((route) => mounted.has(route))).toEqual([]);
  });

  it('refuses at load time to mount an operation of a later milestone', async () => {
    const { Controller } = await import('@nestjs/common');
    const { Operation } = await import('../../src/common/operation.js');
    expect(() => {
      class Later {
        listTeams() {}
      }
      Controller()(Later);
      Operation('listTeams')(Later.prototype, 'listTeams', Object.getOwnPropertyDescriptor(Later.prototype, 'listTeams')!);
    }).toThrow(/belongs to H1|belongs to H\d/);
    expect(() => Operation('doesNotExist' as never)).toThrow(/not in the ENDPOINTS registry/);
  });

  it('answers a registry route that is not mounted yet with 404 NOT_FOUND in the error format', async () => {
    await expectError(await fetch(`${real.baseUrl}/teams`), 'NOT_FOUND');
    await expectError(await fetch(`${real.baseUrl}/nothing-here`), 'NOT_FOUND');
    await expectError(await fetch(`${real.baseUrl}/health`, { method: 'POST' }), 'NOT_FOUND');
  });
});

describe('getHealth (D-H0-12)', () => {
  it('answers 200 without a session and the body validates against its schema', async () => {
    const response = await fetch(`${real.baseUrl}/health`);
    expect(response.status).toBe(200);
    const schema = ENDPOINTS.find((e) => e.id === 'getHealth')!.response.schema!;
    const body = schema.parse(await response.json());
    expect(body).toEqual({ status: 'ok', checks: { database: true, routingEngine: false, weatherProvider: false } });
  });

  it('works with no cookies and does not touch business tables (anonymous transaction)', async () => {
    const response = await fetch(`${real.baseUrl}/health`, { headers: { cookie: 'onway_session=whatever' } });
    expect(response.status).toBe(200);
  });
});

describe('request id', () => {
  it('is generated, echoed in the header and repeated in errors', async () => {
    const ok = await fetch(`${real.baseUrl}/health`);
    expect(ok.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    const error = await expectError(await fetch(`${real.baseUrl}/nope`), 'NOT_FOUND');
    expect(error.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps a well-formed id sent by the caller and replaces a malformed one', async () => {
    const kept = await fetch(`${real.baseUrl}/nope`, { headers: { 'x-request-id': 'caller-request-0001' } });
    expect((await expectError(kept, 'NOT_FOUND')).error.requestId).toBe('caller-request-0001');
    const replaced = await fetch(`${real.baseUrl}/nope`, { headers: { 'x-request-id': 'bad id <script>' } });
    expect((await expectError(replaced, 'NOT_FOUND')).error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('validation from the registry (D-H0-06, AC-16)', () => {
  const post = (body: string, headers: Record<string, string> = {}) => fetch(`${real.baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  it('rejects an invalid body with 400 VALIDATION_FAILED and issues', async () => {
    const parsed = await expectError(await post(JSON.stringify({ email: 'not-an-email' })), 'VALIDATION_FAILED');
    const issues = (parsed.error.details as { issues: { path: string; code: string; message: string }[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.path)).toContain('email');
    expect(issues.map((i) => i.path)).toContain('password');
    for (const issue of issues) expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path']);
  });

  it('rejects an unknown field in the request (strict objects): a client cannot ask for a role', async () => {
    const parsed = await expectError(await post(JSON.stringify({ email: 'a@example.org', password: 'x', role: 'admin' })), 'VALIDATION_FAILED');
    expect(JSON.stringify(parsed.error.details)).toContain('role');
  });

  it('rejects a body that is not JSON with VALIDATION_FAILED, not an HTML page', async () => {
    await expectError(await post('{"email": '), 'VALIDATION_FAILED');
  });

  it('answers 413 FILE_TOO_LARGE when the body exceeds the limit', async () => {
    await expectError(await post(JSON.stringify({ email: 'a@example.org', password: 'x'.repeat(200_000) })), 'FILE_TOO_LARGE');
  });

  it('hands the handler the parsed body when it is valid (the email arrives lower-cased)', async () => {
    const org = await fixtures.organization('Parsed');
    const member = await fixtures.member(org, 'coordinator', 'active', { password: TEST_PASSWORD });
    const response = await post(JSON.stringify({ email: member.email.toUpperCase(), password: TEST_PASSWORD }));
    expect(response.status).toBe(200);
  });
});

describe('guard and response checks (RF-103 base, AC-16)', () => {
  it('refuses a non-public operation with no session: 401 UNAUTHENTICATED', async () => {
    await expectError(await fetch(`${stubbed.baseUrl}/auth/me`), 'UNAUTHENTICATED');
    await expectError(await fetch(`${stubbed.baseUrl}/test-only/staff`), 'UNAUTHENTICATED');
  });

  it('runs the handler inside the session’s transaction with app.org_id, app.user_id and app.role fixed', async () => {
    const org = await fixtures.fullOrganization('Context');
    const coordinator = await fixtures.member(org.orgId, 'coordinator', 'active', { password: TEST_PASSWORD });
    const session = await mustLogin(stubbed, coordinator.email, TEST_PASSWORD);
    const response = await fetch(`${stubbed.baseUrl}/test-only/context`, { headers: withSession(session) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orgId: org.orgId, userId: coordinator.userId, role: 'coordinator', visibleMemberships: 4, visibleUsers: 4 });
  });

  it('turns a response that does not match its contract into 500 INTERNAL with no details', async () => {
    const org = await fixtures.organization('BadResponse');
    const admin = await fixtures.member(org, 'admin', 'active', { password: TEST_PASSWORD });
    const session = await mustLogin(stubbed, admin.email, TEST_PASSWORD);
    const parsed = await expectError(await fetch(`${stubbed.baseUrl}/test-only/bad-response`, { headers: withSession(session) }), 'INTERNAL');
    expect(parsed.error.details).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('not in the contract');
  });
});
