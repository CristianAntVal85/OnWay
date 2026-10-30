import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ERROR_HTTP, type ErrorCode, type ErrorResponse } from '@onway/contracts';
import type { Response } from 'express';
import { DomainError } from './domain-error.js';
import type { OnwayRequest } from './operation.js';

interface Translated {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown> | undefined;
}

/** Statuses of framework or middleware errors (unknown route, malformed JSON, payload too large…) → registry codes. */
const BY_STATUS: Record<number, ErrorCode> = { 404: 'NOT_FOUND', 413: 'FILE_TOO_LARGE', 415: 'UNSUPPORTED_FILE_TYPE' };

function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  const e = exception as { status?: unknown; statusCode?: unknown } | null;
  const status = e?.status ?? e?.statusCode;
  return typeof status === 'number' ? status : undefined;
}

/**
 * The single place that writes errors (D-H0-13, AC-05): `{ error: { code, message, requestId, details? } }`
 * with the status taken from `ERROR_HTTP`. An unexpected error becomes `INTERNAL` with no details.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<OnwayRequest>();
    const response = http.getResponse<Response>();
    const translated = this.translate(exception, request);
    if (translated.code === 'INTERNAL') {
      this.logger.error(`[${request.requestId}] ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`);
    }
    if (response.headersSent) return;

    const body: ErrorResponse = {
      error: { code: translated.code, message: translated.message, requestId: request.requestId, ...(translated.details ? { details: translated.details } : {}) },
    };
    response.status(ERROR_HTTP[translated.code]).json(body);
  }

  private translate(exception: unknown, request: OnwayRequest): Translated {
    if (exception instanceof DomainError) {
      if (exception.code === 'INTERNAL') return { code: 'INTERNAL', message: 'Internal error' };
      return { code: exception.code, message: exception.message, details: exception.details };
    }
    const status = statusOf(exception);
    if (status === 400) {
      const message = exception instanceof Error ? exception.message : 'Bad request';
      return { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: { issues: [{ path: '', code: 'invalid_request', message }] } };
    }
    const code = status === undefined ? undefined : BY_STATUS[status];
    if (code) return { code, message: code === 'NOT_FOUND' ? `Cannot ${request.method} ${request.path}` : 'Request rejected' };
    return { code: 'INTERNAL', message: 'Internal error' };
  }
}
