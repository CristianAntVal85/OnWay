import { describe, expect, it } from 'vitest';
import { SystemClock } from '../../src/clock/clock.js';
import { FixedClock } from '../support/clock.js';

describe('Clock port', () => {
  it('the system clock follows real time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('a fixed clock stays put until advanced', () => {
    const clock = new FixedClock(new Date('2026-10-30T10:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-10-30T10:00:00.000Z');
    clock.advance(15 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-10-30T10:15:00.000Z');
  });
});
