import type { WeatherProvider } from './weather-provider.js';
import { OpenMeteoWeatherProvider } from './open-meteo-weather.js';
import { userAgentOf } from '../geo/config.js';

type Env = Record<string, string | undefined>;

/** Open-Meteo's forecast API. Every URL comes from the configuration (D-H1-15): the end-to-end stack points it at `providers-stub`. */
export const DEFAULT_OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** The real `WeatherProvider`: Open-Meteo at `OPEN_METEO_FORECAST_URL`. */
export function createWeatherProvider(env: Env = process.env): WeatherProvider {
  return new OpenMeteoWeatherProvider({ baseUrl: env.OPEN_METEO_FORECAST_URL || DEFAULT_OPEN_METEO_FORECAST_URL, userAgent: userAgentOf(env) });
}
