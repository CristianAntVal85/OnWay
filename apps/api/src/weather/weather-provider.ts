import type { WeatherDay, WeatherPoint } from '@onway/contracts';
import type { z } from 'zod';

export type ForecastPoint = z.infer<typeof WeatherPoint>;
export type ForecastDay = z.infer<typeof WeatherDay>;

/** What a provider returns for one place: the weather now, the next 7 days by hour and by day. The service slices it per request. */
export interface Forecast {
  current: ForecastPoint | null;
  hourly: ForecastPoint[];
  daily: ForecastDay[];
}

/** Where and at what height the forecast is asked for. `elevationM` is OUR altitude of the place, never the provider's own grid height (R-06). */
export interface WeatherRequest {
  lat: number;
  lon: number;
  elevationM: number;
}

/** The source is down, slow or answered something unusable. The service degrades to the cached forecast or to `unavailable`; it never fails the request. */
export class WeatherUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WeatherUnavailableError';
  }
}

/** How many days ahead the service asks every provider for. The cache key has no `days`, so the horizon is fixed. */
export const FORECAST_DAYS = 7;

/**
 * Port `WeatherProvider` (doc 04 §5.2, R-06): the forecast at the altitude of a point. Throws `WeatherUnavailableError`.
 * `name` is the provider part of the cache key.
 */
export interface WeatherProvider {
  readonly name: string;
  forecast(request: WeatherRequest): Promise<Forecast>;
}

/** Injection token, as `CLOCK` and `ELEVATION_PROVIDER` are. */
export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');
