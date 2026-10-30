import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { DomainError } from './domain-error.js';
import { operationOf, type OnwayRequest } from './operation.js';

/**
 * Roles of the registry, enforced in the server (rule 2). Fails closed: a handler without `@Operation` is
 * refused, and so is any non-public operation while no authenticator has set `request.principal`
 * (the session authenticator and the account-state checks arrive in T5).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const endpoint = operationOf(context.getHandler());
    if (!endpoint) throw new DomainError('INTERNAL', 'handler is not mounted through @Operation');
    if (endpoint.roles.includes('public')) return true;

    const principal = context.switchToHttp().getRequest<OnwayRequest>().principal;
    if (!principal) throw new DomainError('UNAUTHENTICATED');
    if (!endpoint.roles.includes(principal.role)) throw new DomainError('FORBIDDEN');
    return true;
  }
}
