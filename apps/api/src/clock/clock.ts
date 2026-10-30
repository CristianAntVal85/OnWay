/** Port `Clock` (doc 04 §5.2). Session expiry and `retryAfterSeconds` read time only through it. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
