import { describe, expect, it } from 'vitest';
import { clientKey, DEFAULT_TRUSTED_PROXIES, trustedProxiesFromEnv } from '../../src/common/client-ip.js';
import { DEFAULT_PUBLIC_LIMITS, PublicRateLimiter } from '../../src/common/public-rate-limiter.js';
import { DomainError } from '../../src/common/domain-error.js';
import { FixedClock } from '../support/clock.js';

describe('PublicRateLimiter (H5-acceso P4)', () => {
  const start = new Date('2026-11-05T10:00:00Z');
  const small = { register: { max: 2, windowSeconds: 60 }, forgotPassword: { max: 1, windowSeconds: 3600 } };

  it('lets `max` requests through per window, then says how many whole seconds to wait', () => {
    const clock = new FixedClock(start);
    const limiter = new PublicRateLimiter(clock, small);
    expect(limiter.take('register', 'a')).toBe(0);
    clock.advance(10_000);
    expect(limiter.take('register', 'a')).toBe(0);
    expect(limiter.take('register', 'a')).toBe(50); // the first hit leaves the window 50 s from now
  });

  it('is a sliding window: a hit leaves on its own, one by one, and refused requests do not extend it', () => {
    const clock = new FixedClock(start);
    const limiter = new PublicRateLimiter(clock, small);
    limiter.take('register', 'a');
    clock.advance(30_000);
    limiter.take('register', 'a');
    clock.advance(20_000);
    for (let i = 0; i < 5; i++) expect(limiter.take('register', 'a')).toBeGreaterThan(0); // refused: not counted
    clock.advance(10_000); // 60 s after the first hit
    expect(limiter.take('register', 'a')).toBe(0);
    expect(limiter.take('register', 'a')).toBe(30); // the second hit (t=30) leaves at t=90; now it is t=60
  });

  it('counts each client and each operation on its own', () => {
    const limiter = new PublicRateLimiter(new FixedClock(start), small);
    limiter.take('register', 'a');
    limiter.take('register', 'a');
    expect(limiter.take('register', 'a')).toBeGreaterThan(0);
    expect(limiter.take('register', 'b')).toBe(0);
    expect(limiter.take('forgotPassword', 'a')).toBe(0);
    expect(limiter.take('forgotPassword', 'a')).toBe(3600);
    expect(limiter.take('resetPassword', 'a')).toBe(0); // default limit for the operation not overridden
  });

  it('the wait it reports is enough: after it the request goes through', () => {
    const clock = new FixedClock(start);
    const limiter = new PublicRateLimiter(clock, small);
    limiter.take('register', 'a');
    limiter.take('register', 'a');
    const wait = limiter.take('register', 'a');
    clock.advance(wait * 1000);
    expect(limiter.take('register', 'a')).toBe(0);
  });

  it('assert throws RATE_LIMITED with retryAfterSeconds', () => {
    const limiter = new PublicRateLimiter(new FixedClock(start), small);
    limiter.assert('forgotPassword', 'a');
    try {
      limiter.assert('forgotPassword', 'a');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 3600 } });
    }
  });

  it('the defaults: 10 registrations per 10 minutes, 5 recovery requests per hour', () => {
    expect(DEFAULT_PUBLIC_LIMITS.register).toEqual({ max: 10, windowSeconds: 600 });
    expect(DEFAULT_PUBLIC_LIMITS.forgotPassword).toEqual({ max: 5, windowSeconds: 3600 });
    const limiter = new PublicRateLimiter(new FixedClock(start));
    expect(Array.from({ length: 10 }, () => limiter.take('register', 'a'))).toEqual(Array(10).fill(0));
    expect(limiter.take('register', 'a')).toBe(600);
  });

  it('forgets the clients whose window has passed when it holds too many', () => {
    const clock = new FixedClock(start);
    const limiter = new PublicRateLimiter(clock, small);
    for (let i = 0; i < 10_001; i++) limiter.take('register', `client-${i}`);
    expect((limiter as unknown as { windows: Map<string, unknown> }).windows.size).toBeLessThanOrEqual(10_000);
  });
});

describe('clientKey', () => {
  const key = (ip: string | undefined, remote?: string) => clientKey({ ip, socket: { remoteAddress: remote } } as never);

  it('uses the address Express settled on (the socket, or the forwarded client of a trusted proxy)', () => {
    expect(key('203.0.113.5')).toBe('203.0.113.5');
    expect(key(undefined, '203.0.113.6')).toBe('203.0.113.6');
    expect(key(undefined)).toBe('unknown');
  });

  it('an IPv4 address mapped into IPv6 counts as the IPv4 address', () => {
    expect(key('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  it('an IPv6 client counts as its /64, whatever it does inside it', () => {
    expect(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(key('2001:DB8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(key('2001:db8:1::5')).toBe('2001:db8:1:0::/64');
    expect(key('::1')).toBe('0:0:0:0::/64');
  });
});

describe('TRUSTED_PROXIES', () => {
  it('trusts the private ranges by default, and can be narrowed or switched off', () => {
    expect(trustedProxiesFromEnv({})).toBe(DEFAULT_TRUSTED_PROXIES);
    expect(trustedProxiesFromEnv({ TRUSTED_PROXIES: ' ' })).toBe(DEFAULT_TRUSTED_PROXIES);
    expect(trustedProxiesFromEnv({ TRUSTED_PROXIES: '172.18.0.0/16' })).toBe('172.18.0.0/16');
    expect(trustedProxiesFromEnv({ TRUSTED_PROXIES: 'false' })).toBe(false);
  });
});
