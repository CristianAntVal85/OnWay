import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/common/domain-error.js';
import { pgErrorOf } from '../../src/db/errors.js';
import { invalidCoordinator, translateMissionWriteError } from '../../src/missions/errors.js';

const driverError = (code: string, message: string, constraint?: string) => Object.assign(new Error(message), { code, ...(constraint ? { constraint } : {}) });
/** How Drizzle reports a failed statement: its own error with the driver's one as `cause`. */
const wrapped = (cause: Error) => Object.assign(new Error('Failed query'), { cause });

describe('pgErrorOf', () => {
  it('finds the driver error whether it comes bare or wrapped by Drizzle', () => {
    const bare = driverError('23505', 'duplicate key', 'missions_org_name_open_uq');
    expect(pgErrorOf(bare)).toEqual({ code: '23505', constraint: 'missions_org_name_open_uq', message: 'duplicate key' });
    expect(pgErrorOf(wrapped(bare))).toEqual({ code: '23505', constraint: 'missions_org_name_open_uq', message: 'duplicate key' });
  });

  it('ignores errors that are not from the database', () => {
    expect(pgErrorOf(new Error('boom'))).toBeUndefined();
    expect(pgErrorOf(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBeUndefined();
    expect(pgErrorOf(undefined)).toBeUndefined();
    expect(pgErrorOf('text')).toBeUndefined();
  });
});

describe('translateMissionWriteError (D-H1-01)', () => {
  const code = (error: unknown) => {
    try {
      translateMissionWriteError(error);
    } catch (e) {
      return e instanceof DomainError ? e.code : e;
    }
    return undefined;
  };

  it('maps the unique index of open names to DUPLICATE_NAME', () => {
    expect(code(wrapped(driverError('23505', 'duplicate', 'missions_org_name_open_uq')))).toBe('DUPLICATE_NAME');
  });

  it('maps the triggers of INV-11 and INV-03', () => {
    expect(code(wrapped(driverError('23000', 'INV-11: la misión está cerrada')))).toBe('MISSION_CLOSED');
    expect(code(wrapped(driverError('23000', 'INV-03: el responsable debe ser un coordinador activo')))).toBe('VALIDATION_FAILED');
  });

  it('maps the trigger of the lifecycle to INVALID_STATE_TRANSITION', () => {
    expect(code(wrapped(driverError('23000', 'Transición de misión no permitida: planning → closed')))).toBe('INVALID_STATE_TRANSITION');
  });

  it('lets any other error through untouched', () => {
    const other = wrapped(driverError('23505', 'duplicate', 'some_other_index'));
    expect(code(other)).toBe(other);
    const unknown = new Error('boom');
    expect(code(unknown)).toBe(unknown);
  });

  it('the invalid-coordinator answer is one fixed shape, whatever the reason', () => {
    expect(invalidCoordinator().details).toEqual({ issues: [{ path: 'coordinatorId', code: 'invalid_value', message: expect.any(String) }] });
  });
});
