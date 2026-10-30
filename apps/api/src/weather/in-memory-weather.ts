import type { Clock } from '../clock/clock.js';
import { FORECAST_DAYS, WeatherUnavailableError, type Forecast, type WeatherProvider, type WeatherRequest } from './weather-provider.js';

/**
 * Test implementation of the `WeatherProvider` port: a made-up but deterministic forecast that depends on the altitude
 * (colder and windier higher up, so a test can tell two bands apart), no network. It counts its calls, can be made to
 * fail, and can be held back so that a test can send simultaneous requests. Nothing in it is real data.
 */
export class InMemoryWeatherProvider implements WeatherProvider {
  readonly name = 'in-memory';
  /** Every request received, in order. */
  readonly calls: WeatherRequest[] = [];
  /** While set, every call fails with `WeatherUnavailableError`. */
  failing = false;
  /** While set, a call waits for this promise before answering. */
  hold: Promise<void> | null = null;

  constructor(private readonly clock: Clock) {}

  async forecast(request: WeatherRequest): Promise<Forecast> {
    this.calls.push({ ...request });
    if (this.hold) await this.hold;
    if (this.failing) throw new WeatherUnavailableError('test provider is down');

    const start = new Date(this.clock.now());
    start.setUTCMinutes(0, 0, 0);
    const point = (at: Date) => ({
      time: at.toISOString(),
      temperatureC: Math.round((12 - request.elevationM * 0.0065) * 10) / 10,
      windSpeedKmh: Math.round((8 + request.elevationM / 100) * 10) / 10,
      windGustKmh: Math.round((15 + request.elevationM / 50) * 10) / 10,
      precipitationMm: 0,
      snowfallCm: 0,
      cloudCoverPct: 20,
      freezingLevelM: 2800,
    });
    const midnight = new Date(start);
    midnight.setUTCHours(0, 0, 0, 0);
    return {
      current: point(start),
      hourly: Array.from({ length: FORECAST_DAYS * 24 }, (_, h) => point(new Date(midnight.getTime() + h * 3_600_000))),
      daily: Array.from({ length: FORECAST_DAYS }, (_, d) => ({
        date: new Date(midnight.getTime() + d * 86_400_000).toISOString().slice(0, 10),
        minC: Math.round((6 - request.elevationM * 0.0065) * 10) / 10,
        maxC: Math.round((14 - request.elevationM * 0.0065) * 10) / 10,
        maxWindGustKmh: 40,
        precipitationMm: 0,
        snowfallCm: 0,
      })),
    };
  }
}
