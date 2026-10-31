import { GeocodingRateLimitedError } from './geocoding.js';

export interface SpacedGateOptions {
  /** Minimum time between two requests to the source. */
  intervalMs: number;
  /** How long a request may queue before it is refused instead. */
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The global bucket of the geocoder (R-09): one request to the source per `intervalMs` in the whole API, however many
 * users ask at once. Requests that arrive together are queued one `intervalMs` apart; one that would wait longer than
 * `maxWaitMs` is refused with the seconds to wait.
 */
export class SpacedGate {
  private nextFree = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: SpacedGateOptions) {
    this.now = options.now ?? (() => performance.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Resolves when the caller may send its request. */
  async acquire(): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.nextFree);
    const wait = start - now;
    if (wait > this.options.maxWaitMs) throw new GeocodingRateLimitedError(Math.max(1, Math.ceil(wait / 1000)));
    this.nextFree = start + this.options.intervalMs;
    if (wait > 0) await this.sleep(wait);
  }
}
