import { describe, expect, it } from 'vitest';
import { UserRateLimiter } from '../../src/geo/rate-limiter.js';
import { FixedClock } from '../support/clock.js';

describe('UserRateLimiter (D-H1-09: the altitude indicator)', () => {
  const start = new Date('2026-10-30T10:00:00Z');

  it('lets a burst through, then asks to wait the whole seconds until a request is free again', () => {
    const limiter = new UserRateLimiter(new FixedClock(start), { burst: 3, perSecond: 1 });
    expect([limiter.take('u'), limiter.take('u'), limiter.take('u')]).toEqual([0, 0, 0]);
    expect(limiter.take('u')).toBe(1);
  });

  it('gives requests back as time passes, up to the burst and no more', () => {
    const clock = new FixedClock(start);
    const limiter = new UserRateLimiter(clock, { burst: 2, perSecond: 2 });
    limiter.take('u');
    limiter.take('u');
    expect(limiter.take('u')).toBeGreaterThan(0);
    clock.advance(500);
    expect(limiter.take('u')).toBe(0);
    expect(limiter.take('u')).toBeGreaterThan(0);
    clock.advance(60_000);
    expect([limiter.take('u'), limiter.take('u'), limiter.take('u')].map((s) => s > 0)).toEqual([false, false, true]);
  });

  it('counts each user on their own', () => {
    const limiter = new UserRateLimiter(new FixedClock(start), { burst: 1, perSecond: 0.1 });
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBeGreaterThan(0);
    expect(limiter.take('b')).toBe(0);
  });

  it('the wait it reports is enough: after it, the request goes through', () => {
    const clock = new FixedClock(start);
    const limiter = new UserRateLimiter(clock, { burst: 1, perSecond: 0.25 });
    limiter.take('u');
    const wait = limiter.take('u');
    expect(wait).toBe(4);
    clock.advance(wait * 1000);
    expect(limiter.take('u')).toBe(0);
  });
});
