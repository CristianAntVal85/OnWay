import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** CSRF token = HMAC-SHA256(secret, session token) (D-H0-08): stateless, tied to one session, useless to another. */
export function csrfTokenFor(secret: Buffer, sessionToken: string): string {
  return createHmac('sha256', secret).update(sessionToken).digest('base64url');
}

/** Constant-time comparison; both sides are hashed first so a different length does not leak through timing. */
export function csrfMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(received).digest();
  return timingSafeEqual(a, b);
}
