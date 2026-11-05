import { Logger, type ArgumentsHost, type LoggerService } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { afterEach, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter.js';
import { loggableError } from '../../src/common/loggable-error.js';

const INVITE_CODE = 'DEMO-AB12-CD34-EF56';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';
const TOKEN_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function driverError(): Error {
  return Object.assign(new Error('connection terminated unexpectedly'), { code: '08006' });
}

describe('loggableError', () => {
  it('drops the bound parameters of a failed query and keeps the SQL, the cause and the call site', () => {
    const error = new DrizzleQueryError('select * from signup where code = $1 and hash = $2', [INVITE_CODE, HASH, TOKEN_HASH], driverError());
    expect(error.stack).toContain(INVITE_CODE); // what a plain `error.stack` would have written

    const text = loggableError(error);
    expect(text).not.toContain(INVITE_CODE);
    expect(text).not.toContain(HASH);
    expect(text).not.toContain(TOKEN_HASH);
    expect(text).not.toContain('params:');
    expect(text).toContain('select * from signup where code = $1 and hash = $2');
    expect(text).toContain('connection terminated unexpectedly');
    expect(text).toMatch(/\n\s+at /);
  });

  it('logs any other error as before', () => {
    const error = new Error('boom');
    expect(loggableError(error)).toBe(error.stack);
    expect(loggableError('plain')).toBe('plain');
  });
});

describe('AllExceptionsFilter', () => {
  afterEach(() => Logger.overrideLogger(false));

  it('answers INTERNAL and never logs the parameters of a failed query', () => {
    const lines: string[] = [];
    const capture: LoggerService = {
      log: () => undefined,
      warn: () => undefined,
      error: (message: unknown) => void lines.push(String(message)),
    };
    Logger.overrideLogger(capture);

    let status = 0;
    let body: { error: { code: string; message: string } } | undefined;
    const response = {
      headersSent: false,
      status(value: number) {
        status = value;
        return this;
      },
      json(value: typeof body) {
        body = value;
      },
    };
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ requestId: 'req-1', method: 'POST', path: '/api/v1/auth/register' }), getResponse: () => response }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(new DrizzleQueryError('insert into users (email, hash) values ($1, $2)', [INVITE_CODE, HASH], driverError()), host);

    expect(status).toBe(500);
    expect(body?.error.code).toBe('INTERNAL');
    expect(body?.error.message).toBe('Internal error');
    const logged = lines.join('\n');
    expect(logged).toContain('req-1');
    expect(logged).toContain('insert into users (email, hash) values ($1, $2)');
    expect(logged).not.toContain(INVITE_CODE);
    expect(logged).not.toContain(HASH);
  });
});
