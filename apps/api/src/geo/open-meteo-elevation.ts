import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ElevationProvider, GroundPoint } from './elevation.js';

const Answer = z.object({ elevation: z.array(z.number().nullable()).length(1) });

export interface OpenMeteoElevationOptions {
  /** `https://api.open-meteo.com/v1/elevation` by default (Copernicus GLO-90, worldwide; same non-commercial quota as the forecast). */
  baseUrl: string;
  /** Names the application, as the geocoder does; Open-Meteo asks nothing, but a polite client says who it is. */
  userAgent?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Answers kept so that a cursor moving over the same spot does not spend the daily quota (R-09). */
  cacheSize?: number;
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
    // About 11 m: far below the 90 m grid of the model, so the cached value is the one the source would give.
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const url = new URL(this.options.baseUrl);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
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
      const metres = parsed.success ? parsed.data.elevation[0] : undefined;
      if (metres === undefined || metres === null) return null;
      const rounded = Math.round(metres * 10) / 10;
      this.remember(key, rounded);
      return rounded;
    } catch (error) {
      this.logger.warn(`elevation source unreachable: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private remember(key: string, metres: number): void {
    this.cache.set(key, metres);
    const limit = this.options.cacheSize ?? 2000;
    if (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value as string);
  }
}
