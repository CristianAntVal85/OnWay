import { Inject, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_FILE_BYTES, type Endpoint, type ErrorCode } from '@onway/contracts';
import { from, lastValueFrom, of, type Observable } from 'rxjs';
import type { ZodError } from 'zod';
import { DatabaseService } from '../db/database.service.js';
import { DomainError } from './domain-error.js';
import { operationOf, type OnwayRequest, type OperationInput } from './operation.js';

/**
 * A refinement of the contract may name, as its message, an error code that the operation declares (`DocumentInput` says
 * `INVALID_DOCUMENT`, doc 06): when every issue is of that kind the answer is that code, with the same `issues`; otherwise the usual
 * `VALIDATION_FAILED`.
 */
export function inputError(error: ZodError, declared: readonly ErrorCode[] = []): DomainError {
  const codes = new Set(error.issues.map((i) => i.message));
  const [only] = [...codes];
  if (codes.size === 1 && declared.includes(only as ErrorCode)) {
    return new DomainError(only as ErrorCode, 'Request validation failed', { issues: error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })) });
  }
  return validationFailed(error);
}

export function validationFailed(error: ZodError): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
  });
}

/**
 * Reads `multipart/form-data` into `request.body` (the fields) and `request.file`. Multer keeps the file in memory and stops at the
 * limit: past it the error is a 413 (`FILE_TOO_LARGE`), a second file, an unexpected field or a broken body is a 400. One file, a few fields.
 */
const multipartReader = new (FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4, parts: 6 } }))();

/**
 * Per operation: validates params, query and body with the registry schemas (400 `VALIDATION_FAILED` with
 * `issues`), runs the handler inside the request's transaction when there is a principal, and checks the
 * response against its schema (AC-16: a field the contract does not declare never leaves the server).
 */
@Injectable()
export class OperationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationInterceptor.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.handle(context, next));
  }

  private async handle(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const endpoint = operationOf(context.getHandler());
    if (!endpoint) throw new DomainError('INTERNAL', 'handler is not mounted through @Operation');
    const request = context.switchToHttp().getRequest<OnwayRequest>();
    // Before the transaction opens: a slow upload must not hold a database connection. The guard has already checked session, CSRF and role.
    if (endpoint.multipart) await lastValueFrom(await multipartReader.intercept(context, { handle: () => of(undefined) }), { defaultValue: undefined });
    request.input = this.parse(endpoint, request);

    const run = () => lastValueFrom(next.handle(), { defaultValue: undefined });
    const value = request.principal ? await this.database.withPrincipal(request.principal, run) : await run();
    return this.check(endpoint, value, request);
  }

  private parse(endpoint: Endpoint, request: OnwayRequest): OperationInput {
    const parse = (schema: Endpoint['params'] | Endpoint['body'], value: unknown): unknown => {
      if (!schema) return undefined;
      const result = schema.safeParse(value);
      if (!result.success) throw inputError(result.error, endpoint.errors ?? []);
      return result.data;
    };
    return {
      params: parse(endpoint.params, request.params),
      query: parse(endpoint.query, request.query),
      body: parse(endpoint.body ?? endpoint.multipart, request.body ?? {}),
    };
  }

  private check(endpoint: Endpoint, value: unknown, request: OnwayRequest): unknown {
    const schema = endpoint.response.schema;
    if (!schema) return value;
    const result = schema.safeParse(value);
    if (!result.success) {
      this.logger.error(`[${request.requestId}] ${endpoint.id} produced a response that does not match its contract: ${result.error.message}`);
      throw new DomainError('INTERNAL', 'Internal error');
    }
    return result.data;
  }
}
