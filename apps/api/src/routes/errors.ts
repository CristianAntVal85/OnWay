import { DomainError } from '../common/domain-error.js';
import { pgErrorOf } from '../db/errors.js';

/**
 * Turns what the database says about a rejected write into the registry error: the triggers of INV-04 (a validated version
 * does not change) and INV-07 (a route in an open mission is not archived). They are the second defence behind the checks of
 * the service, which look first because a statement that fails aborts the whole transaction. Anything else goes on as it is.
 */
export function translateRouteWriteError(error: unknown): never {
  const failure = pgErrorOf(error);
  if (failure?.code === '23000') {
    if (failure.message.includes('INV-04')) throw new DomainError('VERSION_IMMUTABLE');
    if (failure.message.includes('INV-07')) throw new DomainError('ROUTE_IN_USE', undefined, { missions: [] });
  }
  throw error;
}
