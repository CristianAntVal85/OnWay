import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AccessGuard } from '../../src/common/access.guard.js';
import { DomainError } from '../../src/common/domain-error.js';
import { OPERATION_KEY, type Principal } from '../../src/common/operation.js';

function context(operationId: string | undefined, principal?: Principal): ExecutionContext {
  const handler = () => {};
  if (operationId) Reflect.defineMetadata(OPERATION_KEY, operationId, handler);
  return { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => ({ principal }) }) } as unknown as ExecutionContext;
}

const principal = (role: Principal['role']): Principal => ({ orgId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', role });
const guard = new AccessGuard();
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'other';
  }
  return 'none';
};

describe('AccessGuard: roles come from the registry (RF-103, rule 2)', () => {
  it('lets a public operation through without a principal', () => {
    expect(guard.canActivate(context('getHealth'))).toBe(true);
  });

  it('401 UNAUTHENTICATED for a non-public operation without a principal', () => {
    expect(codeOf(() => guard.canActivate(context('getOrganization')))).toBe('UNAUTHENTICATED');
  });

  it('403 FORBIDDEN when the role is not listed (listTeams is staff only; the rescuer is not)', () => {
    expect(codeOf(() => guard.canActivate(context('listTeams', principal('rescuer'))))).toBe('FORBIDDEN');
    expect(guard.canActivate(context('listTeams', principal('coordinator')))).toBe(true);
    expect(guard.canActivate(context('listTeams', principal('admin')))).toBe(true);
  });

  it('a handler not mounted through @Operation is refused', () => {
    expect(codeOf(() => guard.canActivate(context(undefined, principal('admin'))))).toBe('INTERNAL');
  });
});
