import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ELEVATION_PROVIDER, type ElevationProvider } from './elevation.js';
import { SyntheticElevationProvider } from './synthetic-elevation.js';

/** Provides the `ElevationProvider` port to every module; tests pass their own. */
@Global()
@Module({})
export class GeoModule {
  static register(elevation: ElevationProvider = new SyntheticElevationProvider()): DynamicModule {
    return { module: GeoModule, providers: [{ provide: ELEVATION_PROVIDER, useValue: elevation }], exports: [ELEVATION_PROVIDER] };
  }
}
