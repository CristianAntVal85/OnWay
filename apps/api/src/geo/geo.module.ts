import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ELEVATION_PROVIDER, type ElevationProvider } from './elevation.js';
import { GeoController } from './geo.controller.js';
import { ELEVATION_LIMIT, GeoService } from './geo.service.js';
import { GEOCODING_PROVIDER, InMemoryGeocodingProvider, type GeocodingProvider } from './geocoding.js';
import type { UserLimitOptions } from './rate-limiter.js';
import { SyntheticElevationProvider } from './synthetic-elevation.js';

export interface GeoOptions {
  elevation?: ElevationProvider;
  geocoding?: GeocodingProvider;
  /** Per-user limit of `getElevation`. */
  elevationLimit?: UserLimitOptions;
}

/**
 * Provides the `ElevationProvider` and `GeocodingProvider` ports to every module and mounts `geocode` and `getElevation`.
 * Without options the test implementations answer; `main.ts` always passes the real ones (`createElevationProvider`, `createGeocodingProvider`).
 */
@Global()
@Module({})
export class GeoModule {
  static register(options: GeoOptions = {}): DynamicModule {
    return {
      module: GeoModule,
      controllers: [GeoController],
      providers: [
        { provide: ELEVATION_PROVIDER, useValue: options.elevation ?? new SyntheticElevationProvider() },
        { provide: GEOCODING_PROVIDER, useValue: options.geocoding ?? new InMemoryGeocodingProvider() },
        { provide: ELEVATION_LIMIT, useValue: options.elevationLimit },
        GeoService,
      ],
      exports: [ELEVATION_PROVIDER, GEOCODING_PROVIDER],
    };
  }
}
