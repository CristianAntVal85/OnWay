import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { DomainError } from './domain-error.js';
import { AUTHENTICATOR, type Authenticator } from './authenticator.js';
import { csrfMatches } from './csrf.js';
import { operationOf, type OnwayRequest } from './operation.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Who may call what, decided in the server (rule 2) in this order (D-H0-11): session (and the state of the
 * account) → CSRF token → pending account → role listed in the registry. Fails closed: a handler without
 * `@Operation` is refused. `login` and the other public operations carry no session, so they need no CSRF token.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(AUTHENTICATOR) private readonly authenticator: Authenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const endpoint = operationOf(context.getHandler());
    if (!endpoint) throw new DomainError('INTERNAL', 'handler is not mounted through @Operation');
    if (endpoint.roles.includes('public')) return true;

    const request = context.switchToHttp().getRequest<OnwayRequest>();
    const principal = await this.authenticator.authenticate(request);
    request.principal = principal;

    if (!SAFE_METHODS.has(request.method) && !csrfMatches(principal.csrfToken, request.header('x-csrf-token'))) throw new DomainError('CSRF_FAILED');
    // A pending account reaches only the operations that list `pending` (getMe, logout).
    if (principal.role === 'pending' && !endpoint.roles.includes('pending')) throw new DomainError('ACCOUNT_PENDING');
    if (!endpoint.roles.includes(principal.role)) throw new DomainError('FORBIDDEN');
    return true;
  }
}
