import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { WeatherDay, WeatherPoint } from '@onway/contracts';
import type { Tx } from '../db/database.service.js';
import type { Forecast } from './weather-provider.js';

/** Where a forecast lives: provider, ~1 km cell (0,01°) and 100 m altitude band (doc 05). There is NO user or organization in it (INV-30). */
export interface ForecastKey {
  provider: string;
  cellLat: number;
  cellLon: number;
  elevationBand: number;
}

export interface CachedForecast {
  forecast: Forecast;
  fetchedAt: string;
  fresh: boolean;
}

/** How long a forecast is served without asking again (doc 04 §9.1: a few hours; 3 h, D-H1-12 context). */
export const FORECAST_TTL_MS = 3 * 3_600_000;
/** Rows expired for longer than this are dropped when a new one is written: the table keeps cells people looked at, not a history. */
const KEEP_EXPIRED_MS = 7 * 86_400_000;

const Stored = z.object({ current: WeatherPoint.nullable(), hourly: z.array(WeatherPoint), daily: z.array(WeatherDay) });

/**
 * The `forecast_cache` table (migration 0006). It has no organization and no row level security: it holds public data
 * of a rounded point. Both functions run in the transaction of the request.
 */
export async function readForecast(tx: Tx, key: ForecastKey, now: Date): Promise<CachedForecast | null> {
  const { rows } = await tx.execute(sql`
    SELECT data, to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fetched_at, expires_at > ${now.toISOString()}::timestamptz AS fresh
      FROM forecast_cache
     WHERE provider = ${key.provider} AND cell_lat = ${key.cellLat}::numeric AND cell_lon = ${key.cellLon}::numeric AND elevation_band = ${key.elevationBand}::smallint`);
  const row = rows[0] as { data: unknown; fetched_at: string; fresh: boolean } | undefined;
  if (!row) return null;
  const stored = Stored.safeParse(row.data);
  // A row that no longer fits the contract (a change of shape between versions) is a miss, not a failure.
  if (!stored.success) return null;
  return { forecast: stored.data, fetchedAt: row.fetched_at, fresh: row.fresh };
}

export async function writeForecast(tx: Tx, key: ForecastKey, forecast: Forecast, fetchedAt: Date): Promise<void> {
  const fetched = fetchedAt.toISOString();
  const expires = new Date(fetchedAt.getTime() + FORECAST_TTL_MS).toISOString();
  await tx.execute(sql`
    INSERT INTO forecast_cache (provider, cell_lat, cell_lon, elevation_band, data, fetched_at, expires_at)
    VALUES (${key.provider}, ${key.cellLat}::numeric, ${key.cellLon}::numeric, ${key.elevationBand}::smallint, ${JSON.stringify(forecast)}::jsonb, ${fetched}::timestamptz, ${expires}::timestamptz)
    ON CONFLICT (provider, cell_lat, cell_lon, elevation_band)
    DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`);
  await tx.execute(sql`DELETE FROM forecast_cache WHERE expires_at < ${new Date(fetchedAt.getTime() - KEEP_EXPIRED_MS).toISOString()}::timestamptz`);
}
