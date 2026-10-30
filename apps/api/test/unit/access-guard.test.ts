import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccessGuard } from '../../src/common/access.guard.js';
import type { Authenticator } from '../../src/common/authenticator.js';
import { csrfTokenFor } from '../../src/common/csrf.js';
import { DomainError } from '../../src/common/domain-error.js';
import { endpointById, OPERATION_KEY, type Principal } from '../../src/common/operation.js';

const secret = Buffer.alloc(32, 7);
const sessionToken = 'a'.repeat(43);
const csrf = csrfTokenFor(secret, sessionToken);

function request(method: string, csrfHeader?: string) {
  const r: Record<string, unknown> = { method, header: (name: string) => (name === 'x-csrf-token' ? csrfHeader : undefined) };
  return r;
}

function context(operationId: string | undefined, req: Record<string, unknown>): ExecutionContext {
  const handler = () => {};
  if (operationId) Reflect.defineMetadata(OPERATION_KEY, endpointById(operationId), handler);
  return { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

const principal = (role: Principal['role']): Principal => ({
  userId: '22222222-2222-4222-8222-222222222222',
  orgId: role === 'pending' ? null : '11111111-1111-4111-8111-111111111111',
  role,
  accountStatus: role === 'pending' ? 'pending' : 'active',
  sessionId: Buffer.alloc(32),
  csrfToken: csrf,
});

/** An authenticator that answers with a fixed principal, or fails like the real one. */
const authenticator = (outcome: Principal | DomainError | undefined): Authenticator => ({
  async authenticate() {
    if (outcome instanceof DomainError) throw outcome;
    if (!outcome) throw new DomainError('UNAUTHENTICATED');
    return outcome;
  },
});

async function run(operationId: string | undefined, req: Record<string, unknown>, outcome: Principal | DomainError | undefined) {
  try {
    return await new AccessGuard(authenticator(outcome)).canActivate(context(operationId, req));
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
}

describe('AccessGuard: session, CSRF, account state and roles from the registry (RF-103, rule 2)', () => {
  it('lets a public operation through without asking for a session', async () => {
    expect(await run('getHealth', request('GET'), undefined)).toBe(true);
    expect(await run('login', request('POST'), undefined)).toBe(true);
  });

  it('401 UNAUTHENTICATED for a non-public operation without a session; the authenticator’s own error is kept', async () => {
    expect(await run('getOrganization', request('GET'), undefined)).toBe('UNAUTHENTICATED');
    expect(await run('getMe', request('GET'), new DomainError('SESSION_EXPIRED'))).toBe('SESSION_EXPIRED');
    expect(await run('getMe', request('GET'), new DomainError('ACCOUNT_DISABLED'))).toBe('ACCOUNT_DISABLED');
  });

  it('403 FORBIDDEN when the role is not listed (listTeams is staff only; the rescuer is not)', async () => {
    expect(await run('listTeams', request('GET'), principal('rescuer'))).toBe('FORBIDDEN');
    expect(await run('listTeams', request('GET'), principal('coordinator'))).toBe(true);
    expect(await run('listTeams', request('GET'), principal('admin'))).toBe(true);
  });

  it('a pending account reaches only what lists `pending`: 403 ACCOUNT_PENDING elsewhere (INV-25)', async () => {
    expect(await run('getMe', request('GET'), principal('pending'))).toBe(true);
    expect(await run('logout', request('POST', csrf), principal('pending'))).toBe(true);
    expect(await run('listTeams', request('GET'), principal('pending'))).toBe('ACCOUNT_PENDING');
    expect(await run('getOrganization', request('GET'), principal('pending'))).toBe('ACCOUNT_PENDING');
  });

  it('asks for X-CSRF-Token on anything that is not GET, HEAD or OPTIONS (D-H0-08)', async () => {
    expect(await run('logout', request('POST'), principal('rescuer'))).toBe('CSRF_FAILED');
    expect(await run('logout', request('POST', 'wrong'), principal('rescuer'))).toBe('CSRF_FAILED');
    expect(await run('logout', request('POST', csrf), principal('rescuer'))).toBe(true);
    expect(await run('getMe', request('GET'), principal('rescuer'))).toBe(true);
  });

  it('checks CSRF before the role, so a forged request learns nothing about permissions', async () => {
    expect(await run('updateMe', request('PATCH'), principal('rescuer'))).toBe('CSRF_FAILED');
  });

  it('a handler not mounted through @Operation is refused', async () => {
    expect(await run(undefined, request('GET'), principal('admin'))).toBe('INTERNAL');
  });
});
