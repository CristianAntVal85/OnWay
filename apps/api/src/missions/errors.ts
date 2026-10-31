import { DomainError } from '../common/domain-error.js';
import { pgErrorOf } from '../db/errors.js';

/** Same answer for a coordinator that is not one, is not active or belongs to another organization: it reveals nothing (D-H1-03). */
export function invalidCoordinator(): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path: 'coordinatorId', code: 'invalid_value', message: 'The coordinator must be an active coordinator of the organization' }],
  });
}

/**
 * Turns what the database says about a rejected write into the registry error (D-H1-01): the unique index of open
 * names, and the triggers `missions_guard` / `assert_mission_open` (the second defence behind the checks of the service).
 * Anything else is unexpected and goes on as it is.
 */
export function translateMissionWriteError(error: unknown): never {
  const failure = pgErrorOf(error);
  if (failure?.code === '23505' && failure.constraint === 'missions_org_name_open_uq') throw new DomainError('DUPLICATE_NAME');
  if (failure?.code === '23000') {
    if (failure.message.includes('INV-11')) throw new DomainError('MISSION_CLOSED');
    if (failure.message.includes('INV-03')) throw invalidCoordinator();
    if (failure.message.includes('Transición de misión no permitida')) throw new DomainError('INVALID_STATE_TRANSITION');
  }
  throw error;
}
