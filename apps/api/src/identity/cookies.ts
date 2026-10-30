export const SESSION_COOKIE = 'onway_session';
const PATH = '/api';

/** Reads one cookie from the `Cookie` header without a library (D-H0-07). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

const attributes = (maxAgeSeconds: number) => `Max-Age=${maxAgeSeconds}; Path=${PATH}; HttpOnly; Secure; SameSite=Strict`;

/** `HttpOnly` (no script reads it), `Secure`, `SameSite=Strict` (AC-04); always all three, also in tests. */
export const sessionCookie = (token: string, maxAgeSeconds: number) => `${SESSION_COOKIE}=${token}; ${attributes(maxAgeSeconds)}`;
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; ${attributes(0)}`;
