import { Inject, Injectable } from '@nestjs/common';
import type { ElevationQuery, GeocodeQuery, OperationOutput } from '@onway/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { ELEVATION_PROVIDER, type ElevationProvider } from './elevation.js';
import { GEOCODING_PROVIDER, GeocodingRateLimitedError, GeocodingUnavailableError, type GeocodingProvider } from './geocoding.js';
import { DEFAULT_ELEVATION_LIMIT, UserRateLimiter, type UserLimitOptions } from './rate-limiter.js';

/** Injection token for the per-user limit of `getElevation`; tests pass a small one. */
export const ELEVATION_LIMIT = Symbol('ELEVATION_LIMIT');

/** `getElevation` and `geocode` (RF-302, RF-401): the map's altitude indicator and the address search. */
@Injectable()
export class GeoService {
  private readonly limiter: UserRateLimiter;

  constructor(
    @Inject(ELEVATION_PROVIDER) private readonly elevation: ElevationProvider,
    @Inject(GEOCODING_PROVIDER) private readonly geocoding: GeocodingProvider,
    @Inject(CLOCK) clock: Clock,
    @Inject(ELEVATION_LIMIT) limit: UserLimitOptions | undefined,
  ) {
    this.limiter = new UserRateLimiter(clock, limit ?? DEFAULT_ELEVATION_LIMIT);
  }

  async elevationAt(principal: Principal, query: z.infer<typeof ElevationQuery>): Promise<OperationOutput<'getElevation'>> {
    const retryAfterSeconds = this.limiter.take(principal.userId);
    if (retryAfterSeconds > 0) throw new DomainError('RATE_LIMITED', 'Too many altitude requests', { retryAfterSeconds });
    const elevationM = await this.elevation.elevationAt({ lat: query.lat, lon: query.lon });
    if (elevationM === null) throw new DomainError('OUTSIDE_COVERAGE', 'No elevation source covers this point');
    return { lat: query.lat, lon: query.lon, elevationM };
  }

  async geocode(query: z.infer<typeof GeocodeQuery>): Promise<OperationOutput<'geocode'>> {
    try {
      return { items: (await this.geocoding.search(query.q)).slice(0, 10) };
    } catch (error) {
      if (error instanceof GeocodingRateLimitedError) throw new DomainError('RATE_LIMITED', 'Geocoding is rate limited', { retryAfterSeconds: error.retryAfterSeconds });
      if (error instanceof GeocodingUnavailableError) throw new DomainError('UPSTREAM_UNAVAILABLE', 'The address search is not available');
      throw error;
    }
  }
}
