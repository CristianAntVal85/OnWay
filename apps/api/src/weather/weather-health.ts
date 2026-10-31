import type { Clock } from '../clock/clock.js';

/** How long a failed call keeps `weatherProvider` at `false` (D-H1-12). */
export const WEATHER_FAILURE_WINDOW_MS = 30 * 60_000;

/**
 * Passive health of the weather provider (D-H1-12): it only remembers how the last REAL call went. `getHealth` never
 * makes a call of its own (Open-Meteo has a daily quota, R-09; the comprobador asks every few seconds).
 * It is unhealthy only while the last real call failed less than 30 minutes ago; with no call yet, or after a good one,
 * or when the failure is old news, it is healthy: an idle service must not look broken.
 */
export class WeatherHealth {
  private last: { ok: boolean; at: number } | null = null;

  constructor(private readonly clock: Clock) {}

  recordSuccess(): void {
    this.last = { ok: true, at: this.clock.now().getTime() };
  }

  recordFailure(): void {
    this.last = { ok: false, at: this.clock.now().getTime() };
  }

  isHealthy(): boolean {
    if (!this.last || this.last.ok) return true;
    return this.clock.now().getTime() - this.last.at >= WEATHER_FAILURE_WINDOW_MS;
  }
}
