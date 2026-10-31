import { Inject, Injectable } from '@nestjs/common';
import type { EnvironmentQuery, OperationOutput } from '@onway/contracts';
import { elevationBand, moonLight, roundToCell, sunLight, type LatLon } from '@onway/geo';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService } from '../db/database.service.js';
import { ELEVATION_PROVIDER, type ElevationProvider } from '../geo/elevation.js';
import { viewerOf } from '../missions/mission-support.js';
import { readForecast, writeForecast, type ForecastKey } from './forecast-cache.js';
import { WEATHER_PROVIDER, type Forecast, type WeatherProvider } from './weather-provider.js';
import { WeatherHealth } from './weather-health.js';

type Environment = OperationOutput<'getEnvironment'>;
type Query = z.infer<typeof EnvironmentQuery>;
type WeatherBlock = Environment['weather'];

/** After a failed call the cell is not asked again for this long, so a provider that is down is not hammered by every refresh. */
export const FAILURE_BACKOFF_MS = 60_000;
const HOUR_MS = 3_600_000;

interface Place {
  basis: Environment['basis'];
  missionId: string | null;
  /** What the answer says about the place. */
  location: Environment['location'];
  /** Where the forecast is asked: the ~1 km cell of the place (RF-708). */
  cell: LatLon;
  /** The altitude that fixes the band of the forecast. */
  elevationM: number;
}

interface Fetched {
  forecast: Forecast;
  fetchedAt: Date;
}

/**
 * `getEnvironment` (RF-704, RF-705, RF-708, D-H1-10..12): the weather at the altitude of a point, plus sun and moon.
 *
 * - The point is the device position or the target of a mission the caller can see. A device position is rounded to its
 *   ~1 km cell on arrival and never stored or logged (INV-30, RN-26): the only trace is the cell in `forecast_cache`.
 * - A rescuer asking for a mission in planning, or one of another organization, gets 404 (INV-08, INV-01).
 * - The weather comes from the cache of the cell and altitude band (3 h); on a miss, from the provider with OUR altitude
 *   (R-06), one call at a time per cell. If the provider fails: the last cached forecast (`stale`) or `unavailable`, with
 *   status 200 (doc 06). Sun and moon are computed here, in `@onway/geo`, whatever the provider does.
 */
@Injectable()
export class WeatherService {
  private readonly inFlight = new Map<string, Promise<Fetched>>();
  private readonly failedUntil = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WEATHER_PROVIDER) private readonly provider: WeatherProvider,
    @Inject(ELEVATION_PROVIDER) private readonly elevation: ElevationProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WeatherHealth) private readonly health: WeatherHealth,
  ) {}

  async environment(principal: Principal, query: Query): Promise<Environment> {
    const viewer = viewerOf(principal);
    const now = this.clock.now();
    const place = query.missionId ? await this.missionPlace(viewer, query.missionId) : await this.devicePlace(query.lat as number, query.lon as number);
    const sunPoint = { lat: place.location.lat, lon: place.location.lon };
    return {
      basis: place.basis,
      missionId: place.missionId,
      location: place.location,
      weather: await this.weather(place, query.days, now),
      sun: sunLight(now, sunPoint),
      moon: moonLight(now, sunPoint),
      bulletins: [],
    };
  }

  /** Device position: rounded at once; the altitude is ours, at the cell. No source covers it: 422. */
  private async devicePlace(lat: number, lon: number): Promise<Place> {
    const cell = roundToCell({ lat, lon });
    const elevationM = await this.elevation.elevationAt(cell);
    if (elevationM === null) throw new DomainError('OUTSIDE_COVERAGE', 'No elevation source covers this point');
    return { basis: 'device', missionId: null, location: { ...cell, elevationM, country: null }, cell, elevationM };
  }

  /**
   * The target of a mission. Row level security hides planning missions from a rescuer and other organizations from
   * everybody (`missions_select`); the filter here is the second defence. Nothing visible: 404 (D-H1-01).
   */
  private async missionPlace(viewer: { orgId: string; role: 'admin' | 'coordinator' | 'rescuer' }, missionId: string): Promise<Place> {
    const staff = viewer.role !== 'rescuer';
    const { rows } = await this.database.current().execute(sql`
      SELECT ST_Y(target) AS lat, ST_X(target) AS lon, ST_Z(target) AS elevation_m, target_country::text AS country
        FROM missions
       WHERE id = ${missionId} AND organization_id = ${viewer.orgId} AND (${staff} OR status IN ('active', 'closed'))`);
    const row = rows[0] as { lat: number; lon: number; elevation_m: number; country: string | null } | undefined;
    if (!row) throw new DomainError('NOT_FOUND');
    return {
      basis: 'mission',
      missionId,
      location: { lat: row.lat, lon: row.lon, elevationM: row.elevation_m, country: row.country },
      cell: roundToCell({ lat: row.lat, lon: row.lon }),
      elevationM: row.elevation_m,
    };
  }

  private async weather(place: Place, days: number, now: Date): Promise<WeatherBlock> {
    const key: ForecastKey = { provider: this.provider.name, cellLat: place.cell.lat, cellLon: place.cell.lon, elevationBand: elevationBand(place.elevationM) };
    const tx = this.database.current();
    const cached = await readForecast(tx, key, now);
    if (cached?.fresh) return this.block('ok', cached.forecast, cached.fetchedAt, days, now);

    const flightKey = `${key.provider}|${key.cellLat}|${key.cellLon}|${key.elevationBand}`;
    if ((this.failedUntil.get(flightKey) ?? 0) > now.getTime()) return this.degraded(cached, days, now);

    // One call at a time per cell: simultaneous requests wait for the same answer (R-09). The first one stores it.
    let pending = this.inFlight.get(flightKey);
    const leader = !pending;
    if (!pending) {
      pending = this.fetchFresh(key).finally(() => this.inFlight.delete(flightKey));
      this.inFlight.set(flightKey, pending);
    }
    let fetched: Fetched;
    try {
      fetched = await pending;
    } catch {
      this.failedUntil.set(flightKey, this.clock.now().getTime() + FAILURE_BACKOFF_MS);
      return this.degraded(cached, days, now);
    }
    this.failedUntil.delete(flightKey);
    if (leader) await writeForecast(tx, key, fetched.forecast, fetched.fetchedAt);
    return this.block('ok', fetched.forecast, fetched.fetchedAt.toISOString(), days, now);
  }

  /** The real call. Its outcome is what the passive health reports (D-H1-12). The height asked is the band's, so what is cached is a function of the key. */
  private async fetchFresh(key: ForecastKey): Promise<Fetched> {
    try {
      const forecast = await this.provider.forecast({ lat: key.cellLat, lon: key.cellLon, elevationM: key.elevationBand });
      this.health.recordSuccess();
      return { forecast, fetchedAt: this.clock.now() };
    } catch (error) {
      this.health.recordFailure();
      throw error;
    }
  }

  private degraded(cached: { forecast: Forecast; fetchedAt: string } | null, days: number, now: Date): WeatherBlock {
    return cached ? this.block('stale', cached.forecast, cached.fetchedAt, days, now) : { status: 'unavailable', provider: null, fetchedAt: null, current: null, hourly: [], daily: [] };
  }

  /** The next `days` days from the current hour on (the provider also sends the hours already gone). */
  private block(status: 'ok' | 'stale', forecast: Forecast, fetchedAt: string, days: number, now: Date): WeatherBlock {
    const from = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    return {
      status,
      provider: this.provider.name,
      fetchedAt,
      current: forecast.current,
      hourly: forecast.hourly.filter((p) => Date.parse(p.time) >= from).slice(0, days * 24),
      daily: forecast.daily.slice(0, days),
    };
  }
}
