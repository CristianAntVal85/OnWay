import type { Clock } from '../clock/clock.js';

export interface UserLimitOptions {
  /** Requests a user can make in a burst. */
  burst: number;
  /** Requests per second that come back. */
  perSecond: number;
}

/** Defaults for the altitude indicator under the cursor (D-H1-09): about 3 a second sustained, 30 in a burst. */
export const DEFAULT_ELEVATION_LIMIT: UserLimitOptions = { burst: 30, perSecond: 3 };

interface Bucket {
  tokens: number;
  at: number;
}

/**
 * A token bucket per user (D-H1-09). `take` returns 0 when the request may go on, or the whole seconds to wait.
 * Time comes from the `Clock` port. Buckets of users who have been idle long enough to be full again are dropped.
 */
export class UserRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: UserLimitOptions = DEFAULT_ELEVATION_LIMIT,
  ) {}

  take(userId: string): number {
    const now = this.clock.now().getTime();
    const { burst, perSecond } = this.limit;
    const bucket = this.buckets.get(userId) ?? { tokens: burst, at: now };
    bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) / 1000) * perSecond);
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.buckets.set(userId, bucket);
      return Math.max(1, Math.ceil((1 - bucket.tokens) / perSecond));
    }
    bucket.tokens -= 1;
    this.buckets.set(userId, bucket);
    if (this.buckets.size > 1000) this.prune(now);
    return 0;
  }

  private prune(now: number): void {
    const { burst, perSecond } = this.limit;
    for (const [user, bucket] of this.buckets) {
      if (bucket.tokens + ((now - bucket.at) / 1000) * perSecond >= burst) this.buckets.delete(user);
    }
  }
}
