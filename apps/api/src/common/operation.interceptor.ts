import { Inject, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Endpoint } from '@onway/contracts';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { ZodError } from 'zod';
import { DatabaseService } from '../db/database.service.js';
import { DomainError } from './domain-error.js';
import { operationOf, type OnwayRequest, type OperationInput } from './operation.js';

export function validationFailed(error: ZodError): DomainError {
  return new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
  });
}

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
    request.input = this.parse(endpoint, request);

    const run = () => lastValueFrom(next.handle(), { defaultValue: undefined });
    const value = request.principal ? await this.database.withPrincipal(request.principal, run) : await run();
    return this.check(endpoint, value, request);
  }

  private parse(endpoint: Endpoint, request: OnwayRequest): OperationInput {
    const parse = (schema: Endpoint['params'] | Endpoint['body'], value: unknown): unknown => {
      if (!schema) return undefined;
      const result = schema.safeParse(value);
      if (!result.success) throw validationFailed(result.error);
      return result.data;
    };
    return {
      params: parse(endpoint.params, request.params),
      query: parse(endpoint.query, request.query),
      body: parse(endpoint.body, request.body ?? {}),
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
