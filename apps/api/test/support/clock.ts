import type { Clock } from '../../src/clock/clock.js';

/** The fixed clock used by the API tests that need to control time (lockout, session expiry). */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
