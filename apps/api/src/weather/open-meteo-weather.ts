import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { FORECAST_DAYS, WeatherUnavailableError, type Forecast, type ForecastDay, type ForecastPoint, type WeatherProvider, type WeatherRequest } from './weather-provider.js';

const Num = z.number().nullable();
const HOURLY_VARIABLES = ['temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'precipitation', 'snowfall', 'cloud_cover', 'freezing_level_height'] as const;
const DAILY_VARIABLES = ['temperature_2m_max', 'temperature_2m_min', 'wind_gusts_10m_max', 'precipitation_sum', 'snowfall_sum'] as const;

const Series = z.array(Num);
const Answer = z.object({
  utc_offset_seconds: z.number(),
  current: z
    .object({
      time: z.string(),
      temperature_2m: Num,
      wind_speed_10m: Num,
      wind_gusts_10m: Num,
      precipitation: Num,
      snowfall: Num,
      cloud_cover: Num,
      freezing_level_height: Num,
    })
    .optional(),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: Series,
    wind_speed_10m: Series,
    wind_gusts_10m: Series,
    precipitation: Series,
    snowfall: Series,
    cloud_cover: Series,
    freezing_level_height: Series,
  }),
  daily: z.object({ time: z.array(z.string()), temperature_2m_max: Series, temperature_2m_min: Series, wind_gusts_10m_max: Series, precipitation_sum: Series, snowfall_sum: Series }),
});

export interface OpenMeteoWeatherOptions {
  /** `https://api.open-meteo.com/v1/forecast` by default. */
  baseUrl: string;
  /** Names the application; Open-Meteo asks nothing, but a polite client says who it is. */
  userAgent?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
/** One decimal, or `null` if the source has no value. Wind, rain and snow cannot be negative. */
const orNull = (value: number | null | undefined, min = -Infinity) => (value === null || value === undefined ? null : round1(Math.max(min, value)));

/** A local `2026-10-31T14:00` (no offset) of a place whose UTC offset is `offsetSeconds`, as an ISO instant in UTC. `null` if it does not parse. */
function toUtc(local: string, offsetSeconds: number): string | null {
  const ms = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  return Number.isNaN(ms) ? null : new Date(ms - offsetSeconds * 1000).toISOString();
}

/**
 * `WeatherProvider` over Open-Meteo's forecast API (D-18, doc 04 §9: CC BY 4.0, non-commercial, no key). The request carries
 * `elevation` = OUR altitude of the place, so the model is corrected to the summit and not left at the valley (R-06).
 * Times come as the place's local clock (`timezone=auto`) and are returned as UTC instants; the daily dates stay local dates.
 */
export class OpenMeteoWeatherProvider implements WeatherProvider {
  readonly name = 'open-meteo';
  private readonly logger = new Logger(OpenMeteoWeatherProvider.name);

  constructor(private readonly options: OpenMeteoWeatherOptions) {}

  async forecast({ lat, lon, elevationM }: WeatherRequest): Promise<Forecast> {
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('elevation', String(Math.round(elevationM)));
    url.searchParams.set('current', HOURLY_VARIABLES.join(','));
    url.searchParams.set('hourly', HOURLY_VARIABLES.join(','));
    url.searchParams.set('daily', DAILY_VARIABLES.join(','));
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(FORECAST_DAYS));
    url.searchParams.set('wind_speed_unit', 'kmh');

    let body: unknown;
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: 'application/json', ...(this.options.userAgent ? { 'user-agent': this.options.userAgent } : {}) },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        // The status only: the URL carries the place (INV-30 keeps coordinates out of the logs).
        this.logger.warn(`weather source answered ${response.status}`);
        throw new WeatherUnavailableError(`weather source answered ${response.status}`);
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof WeatherUnavailableError) throw error;
      this.logger.warn(`weather source unreachable: ${error instanceof Error ? error.name : 'error'}`);
      throw new WeatherUnavailableError('weather source unreachable');
    }

    const parsed = Answer.safeParse(body);
    if (!parsed.success) {
      this.logger.warn('weather source answered something unexpected');
      throw new WeatherUnavailableError('weather source answered something unexpected');
    }
    const { utc_offset_seconds: offset, current, hourly, daily } = parsed.data;
    return {
      current: current ? this.point(toUtc(current.time, offset), current) : null,
      hourly: hourly.time.flatMap((time, i) => {
        const point = this.point(toUtc(time, offset), {
          temperature_2m: hourly.temperature_2m[i],
          wind_speed_10m: hourly.wind_speed_10m[i],
          wind_gusts_10m: hourly.wind_gusts_10m[i],
          precipitation: hourly.precipitation[i],
          snowfall: hourly.snowfall[i],
          cloud_cover: hourly.cloud_cover[i],
          freezing_level_height: hourly.freezing_level_height[i],
        });
        return point ? [point] : [];
      }),
      daily: daily.time.flatMap((date, i): ForecastDay[] => {
        const max = daily.temperature_2m_max[i];
        const min = daily.temperature_2m_min[i];
        const precipitation = daily.precipitation_sum[i];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || max === null || max === undefined || min === null || min === undefined || precipitation === null || precipitation === undefined) return [];
        return [
          {
            date,
            minC: round1(min),
            maxC: round1(max),
            maxWindGustKmh: orNull(daily.wind_gusts_10m_max[i], 0),
            precipitationMm: round1(Math.max(0, precipitation)),
            snowfallCm: orNull(daily.snowfall_sum[i], 0),
          },
        ];
      }),
    };
  }

  /** A point needs temperature, wind, precipitation and cloud cover; the rest may be absent. Anything else is dropped, not guessed. */
  private point(
    time: string | null,
    v: {
      temperature_2m?: number | null;
      wind_speed_10m?: number | null;
      wind_gusts_10m?: number | null;
      precipitation?: number | null;
      snowfall?: number | null;
      cloud_cover?: number | null;
      freezing_level_height?: number | null;
    },
  ): ForecastPoint | null {
    const { temperature_2m: t, wind_speed_10m: wind, precipitation, cloud_cover: cloud } = v;
    if (time === null || t === null || t === undefined || wind === null || wind === undefined || precipitation === null || precipitation === undefined || cloud === null || cloud === undefined)
      return null;
    return {
      time,
      temperatureC: round1(t),
      windSpeedKmh: round1(Math.max(0, wind)),
      windGustKmh: orNull(v.wind_gusts_10m, 0),
      precipitationMm: round1(Math.max(0, precipitation)),
      snowfallCm: orNull(v.snowfall, 0),
      cloudCoverPct: Math.min(100, Math.max(0, Math.round(cloud))),
      freezingLevelM: v.freezing_level_height === null || v.freezing_level_height === undefined ? null : Math.round(v.freezing_level_height),
    };
  }
}
