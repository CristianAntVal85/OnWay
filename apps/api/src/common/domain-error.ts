import type { ErrorCode } from '@onway/contracts';

/** An error the API answers on purpose. The HTTP status comes from `ERROR_HTTP[code]` (doc 06 §4.1). */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
