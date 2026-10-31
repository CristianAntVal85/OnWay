import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ElevationProvider, GroundPoint } from './elevation.js';

const Answer = z.object({ elevation: z.array(z.number().nullable()) });

/** Open-Meteo accepts up to 100 coordinates per request. */
const BATCH = 100;

export interface OpenMeteoElevationOptions {
  /** `https://api.open-meteo.com/v1/elevation` by default (Copernicus GLO-90, worldwide; same non-commercial quota as the forecast). */
  baseUrl: string;
  /** Names the application, as the geocoder does; Open-Meteo asks nothing, but a polite client says who it is. */
  userAgent?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Answers kept so that a cursor moving over the same spot does not spend the daily quota (R-09). */
  cacheSize?: number;
  /**
   * The most points `elevationsAt` sends in one call (15 requests by default): the quota is shared by every user (R-09) and a
   * route that long should be inside the local DEM. Over it, the points are answered `null` (`OUTSIDE_COVERAGE`).
   */
  maxBatchPoints?: number;
}

/**
 * `ElevationProvider` outside the downloaded box (P1-A): Open-Meteo's elevation API (CC BY 4.0, 10 000 calls/day).
 * Any failure (network, status, shape) is `null`: the caller answers `OUTSIDE_COVERAGE`, it never guesses a height.
 */
export class OpenMeteoElevationProvider implements ElevationProvider {
  private readonly logger = new Logger(OpenMeteoElevationProvider.name);
  private readonly cache = new Map<string, number>();

  constructor(private readonly options: OpenMeteoElevationOptions) {}

  async elevationAt({ lat, lon }: GroundPoint): Promise<number | null> {
    return (await this.elevationsAt([{ lat, lon }]))[0] ?? null;
  }

  async elevationsAt(points: readonly GroundPoint[]): Promise<(number | null)[]> {
    const result: (number | null)[] = points.map(() => null);
    // About 11 m: far below the 90 m grid of the model, so the cached value is the one the source would give.
    const keyOf = ({ lat, lon }: GroundPoint) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const missing = new Map<string, { point: GroundPoint; indexes: number[] }>();
    points.forEach((point, index) => {
      const key = keyOf(point);
      const cached = this.cache.get(key);
      if (cached !== undefined) result[index] = cached;
      else if (missing.has(key)) missing.get(key)!.indexes.push(index);
      else missing.set(key, { point, indexes: [index] });
    });

    const wanted = [...missing.entries()];
    if (wanted.length > (this.options.maxBatchPoints ?? 1500)) {
      this.logger.warn(`elevation request of ${wanted.length} remote points is over the limit: not sent`);
      return result;
    }
    for (let start = 0; start < wanted.length; start += BATCH) {
      const batch = wanted.slice(start, start + BATCH);
      const answers = await this.request(batch.map(([, { point }]) => point));
      batch.forEach(([key, { indexes }], i) => {
        const metres = answers?.[i];
        if (metres === undefined || metres === null) return;
        const rounded = Math.round(metres * 10) / 10;
        this.remember(key, rounded);
        for (const index of indexes) result[index] = rounded;
      });
    }
    return result;
  }

  /** One call for up to `BATCH` points; `null` when the source fails in any way (the caller answers `OUTSIDE_COVERAGE`, it never guesses a height). */
  private async request(points: readonly GroundPoint[]): Promise<(number | null)[] | null> {
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('latitude', points.map((p) => p.lat).join(','));
    url.searchParams.set('longitude', points.map((p) => p.lon).join(','));
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        headers: { accept: 'application/json', ...(this.options.userAgent ? { 'user-agent': this.options.userAgent } : {}) },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
      });
      if (!response.ok) {
        this.logger.warn(`elevation source answered ${response.status}`);
        return null;
      }
      const parsed = Answer.safeParse(await response.json());
      return parsed.success && parsed.data.elevation.length === points.length ? parsed.data.elevation : null;
    } catch (error) {
      // The error's name only: its message can carry the URL, and the URL carries the points asked for.
      this.logger.warn(`elevation source unreachable: ${error instanceof Error ? error.name : 'error'}`);
      return null;
    }
  }

  private remember(key: string, metres: number): void {
    this.cache.set(key, metres);
    const limit = this.options.cacheSize ?? 2000;
    if (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value as string);
  }
}
