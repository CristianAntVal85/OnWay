import type { Clock } from '../clock/clock.js';
import { DomainError } from './domain-error.js';

/** The operations that need no session and so cannot be limited per user: they are limited per client IP (H5-acceso P4). */
export type PublicOperation = 'register' | 'forgotPassword' | 'resetPassword';

export interface WindowLimit {
  /** Requests allowed per client within the window. */
  max: number;
  windowSeconds: number;
}

export type PublicLimits = Record<PublicOperation, WindowLimit>;

/**
 * Defaults: a registration every minute on average is more than a team that signs up together needs; password recovery sends
 * an email, so it is tighter; resetting needs a valid token, so it only has to stop guessing.
 */
export const DEFAULT_PUBLIC_LIMITS: PublicLimits = {
  register: { max: 10, windowSeconds: 10 * 60 },
  forgotPassword: { max: 5, windowSeconds: 60 * 60 },
  resetPassword: { max: 10, windowSeconds: 60 * 60 },
};

/** Past this many live keys the oldest are dropped: the memory of the limiter cannot grow without bound. */
const MAX_KEYS = 10_000;

export const PUBLIC_RATE_LIMITER = Symbol('PUBLIC_RATE_LIMITER');

/**
 * A sliding window per client and operation, in memory (one `api` process; the limit is per process and resets on restart, which is
 * enough for a single-node deployment). Every request that reaches the operation counts, whatever its outcome: counting only failures
 * would let `register` be used to probe codes. Requests that are refused do NOT extend the window. Time comes from the `Clock` port.
 */
export class PublicRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly limits: PublicLimits;

  constructor(
    private readonly clock: Clock,
    limits: Partial<PublicLimits> = {},
  ) {
    this.limits = { ...DEFAULT_PUBLIC_LIMITS, ...limits };
  }

  /** Counts one request: 0 when it may go on, or the whole seconds to wait. */
  take(operation: PublicOperation, client: string): number {
    const { max, windowSeconds } = this.limits[operation];
    const now = this.clock.now().getTime();
    const windowMs = windowSeconds * 1000;
    const key = `${operation}|${client}`;
    const hits = (this.windows.get(key) ?? []).filter((at) => at > now - windowMs);
    if (hits.length >= max) {
      this.windows.set(key, hits);
      return Math.max(1, Math.ceil((hits[0]! + windowMs - now) / 1000));
    }
    hits.push(now);
    this.windows.delete(key); // re-insert: the most recently used keys go last
    this.windows.set(key, hits);
    if (this.windows.size > MAX_KEYS) this.prune(now);
    return 0;
  }

  /** `take`, answering `RATE_LIMITED` (429) with `retryAfterSeconds` when the client is over the limit. */
  assert(operation: PublicOperation, client: string): void {
    const retryAfterSeconds = this.take(operation, client);
    if (retryAfterSeconds > 0) throw new DomainError('RATE_LIMITED', 'Too many requests', { retryAfterSeconds });
  }

  private prune(now: number): void {
    for (const [key, hits] of this.windows) {
      const windowMs = this.limits[key.slice(0, key.indexOf('|')) as PublicOperation].windowSeconds * 1000;
      if (hits.every((at) => at <= now - windowMs)) this.windows.delete(key);
    }
    for (const key of this.windows.keys()) {
      if (this.windows.size <= MAX_KEYS) break;
      this.windows.delete(key);
    }
  }
}
