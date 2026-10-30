import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import type { Clock } from './clock/clock.js';
import { ClockModule } from './clock/clock.module.js';
import { CommonModule } from './common/common.module.js';
import type { DbConnection } from './db/config.js';
import { DatabaseModule } from './db/database.module.js';
import { GeoModule, type GeoOptions } from './geo/geo.module.js';
import { HealthModule } from './health/health.module.js';
import type { IdentityOptions } from './identity/config.js';
import { IdentityModule } from './identity/identity.module.js';
import { MissionsModule } from './missions/missions.module.js';
import { WeatherModule, type WeatherOptions } from './weather/weather.module.js';

export interface AppOptions {
  /** Connection of the API: always `onway_app`. */
  database: DbConnection;
  /** Secret and lifetime of sessions (D-H0-07, D-H0-08). */
  identity: IdentityOptions;
  clock?: Clock;
  /** Altitude source, address search and the per-user altitude limit. Without them the test implementations answer; `main.ts` passes the real ones. */
  geo?: GeoOptions;
  /** Weather provider. Without it the test implementation answers; `main.ts` passes the real one. */
  weather?: WeatherOptions;
  /** Only for tests: controllers of synthetic endpoints (outside the registry) that exercise the guards. */
  extraControllers?: Type<unknown>[];
}

@Module({})
export class AppModule {
  static register(options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ClockModule.register(options.clock),
        GeoModule.register(options.geo),
        DatabaseModule.register(options.database),
        AuditModule,
        IdentityModule.register(options.identity),
        MissionsModule,
        WeatherModule.register(options.weather),
        CommonModule,
        HealthModule,
      ],
      controllers: options.extraControllers ?? [],
    };
  }
}
