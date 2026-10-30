import { describe, expect, it } from 'vitest';
import { csrfMatches, csrfTokenFor } from '../../src/common/csrf.js';
import { clearedSessionCookie, readCookie, sessionCookie } from '../../src/identity/cookies.js';

describe('CSRF token (D-H0-08)', () => {
  const secret = Buffer.alloc(32, 1);

  it('is a stable HMAC of the session token and differs per session and per secret', () => {
    const a = csrfTokenFor(secret, 'session-a');
    expect(a).toBe(csrfTokenFor(secret, 'session-a'));
    expect(a).not.toBe(csrfTokenFor(secret, 'session-b'));
    expect(a).not.toBe(csrfTokenFor(Buffer.alloc(32, 2), 'session-a'));
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain('session-a');
  });

  it('compares without failing on missing or different-length input', () => {
    const a = csrfTokenFor(secret, 'session-a');
    expect(csrfMatches(a, a)).toBe(true);
    expect(csrfMatches(a, undefined)).toBe(false);
    expect(csrfMatches(a, '')).toBe(false);
    expect(csrfMatches(a, `${a}x`)).toBe(false);
    expect(csrfMatches(a, csrfTokenFor(secret, 'session-b'))).toBe(false);
  });
});

describe('session cookie (D-H0-07, AC-04)', () => {
  it('always carries HttpOnly, Secure and SameSite=Strict, scoped to /api', () => {
    const cookie = sessionCookie('token', 43_200);
    expect(cookie).toBe('onway_session=token; Max-Age=43200; Path=/api; HttpOnly; Secure; SameSite=Strict');
  });

  it('is cleared with the same attributes and Max-Age=0', () => {
    expect(clearedSessionCookie()).toBe('onway_session=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict');
  });

  it('reads one cookie from the header without a library', () => {
    expect(readCookie('a=1; onway_session=abc; b=2', 'onway_session')).toBe('abc');
    expect(readCookie('onway_session=abc', 'onway_session')).toBe('abc');
    expect(readCookie('xonway_session=abc', 'onway_session')).toBeUndefined();
    expect(readCookie(undefined, 'onway_session')).toBeUndefined();
    expect(readCookie('garbage', 'onway_session')).toBeUndefined();
  });
});
