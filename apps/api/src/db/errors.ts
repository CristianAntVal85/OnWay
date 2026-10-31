/** What the driver reports about a failed statement (`pg`'s DatabaseError). */
export interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

/** Drizzle wraps the driver error in `DrizzleQueryError`; this digs the original out of the `cause` chain. */
export function pgErrorOf(error: unknown): PgError | undefined {
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === 'string' ? { constraint: candidate.constraint } : {}),
        message: typeof candidate.message === 'string' ? candidate.message : '',
      };
    }
    current = candidate.cause;
  }
  return undefined;
}
