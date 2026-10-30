import type { Request } from 'express';
import type { Principal } from './operation.js';

export const AUTHENTICATOR = Symbol('AUTHENTICATOR');

/**
 * Turns a request into the principal that made it, or throws the registry error that explains why not
 * (`UNAUTHENTICATED`, `SESSION_EXPIRED`, `ACCOUNT_DISABLED`…). The identity module provides it.
 */
export interface Authenticator {
  authenticate(request: Request): Promise<Principal>;
}
