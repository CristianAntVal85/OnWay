import { describe, expect, it } from 'vitest';
import { WEATHER_FAILURE_WINDOW_MS, WeatherHealth } from '../../src/weather/weather-health.js';
import { FixedClock } from '../support/clock.js';

// D-H1-12: passive health. It looks at how the last real call went; nothing here makes a call.
describe('WeatherHealth (D-H1-12)', () => {
  const start = new Date('2026-10-31T10:00:00Z');

  it('is healthy before any call: an idle service does not look broken', () => {
    expect(new WeatherHealth(new FixedClock(start)).isHealthy()).toBe(true);
  });

  it('turns unhealthy when the last real call failed and recovers with the next good one', () => {
    const health = new WeatherHealth(new FixedClock(start));
    health.recordFailure();
    expect(health.isHealthy()).toBe(false);
    health.recordSuccess();
    expect(health.isHealthy()).toBe(true);
  });

  it('forgets a failure after 30 minutes, so an unused provider does not stay "down" for ever', () => {
    const clock = new FixedClock(start);
    const health = new WeatherHealth(clock);
    health.recordFailure();
    clock.advance(WEATHER_FAILURE_WINDOW_MS - 1);
    expect(health.isHealthy()).toBe(false);
    clock.advance(1);
    expect(health.isHealthy()).toBe(true);
  });

  it('a good call is not forgotten into "down" by the passing of time', () => {
    const clock = new FixedClock(start);
    const health = new WeatherHealth(clock);
    health.recordSuccess();
    clock.advance(6 * 3_600_000);
    expect(health.isHealthy()).toBe(true);
  });
});
