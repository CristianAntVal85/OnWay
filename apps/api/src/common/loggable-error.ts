/**
 * Text that is safe to write to the server log for an unexpected error.
 *
 * Drizzle's `DrizzleQueryError` puts the bound parameters in its message (`Failed query: … params: …`), so logging
 * `error.stack` would write invite codes and password or token hashes. For those errors this keeps the SQL text
 * (placeholders only), the stack frames of the call site and the driver error (the `cause`), and drops the parameters.
 * Any other error is logged as is.
 */
export function loggableError(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);
  if (!isQueryError(exception)) return exception.stack ?? exception.message;

  const frames = (exception.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n');
  const cause = exception.cause;
  const causeText = cause instanceof Error ? (cause.stack ?? cause.message) : cause === undefined ? 'unknown' : String(cause);
  return `${exception.name}: query failed (parameters omitted)\n  query: ${exception.query}\n  cause: ${causeText}${frames ? `\n${frames}` : ''}`;
}

function isQueryError(error: Error): error is Error & { query: string; params: unknown } {
  return typeof (error as { query?: unknown }).query === 'string' && 'params' in error;
}
