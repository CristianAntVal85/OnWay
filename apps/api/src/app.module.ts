import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import type { Clock } from './clock/clock.js';
import { ClockModule } from './clock/clock.module.js';
import { CommonModule } from './common/common.module.js';
import type { DbConnection } from './db/config.js';
import { DatabaseModule } from './db/database.module.js';
import { FilesModule, type FilesOptions } from './files/files.module.js';
import { GeoModule, type GeoOptions } from './geo/geo.module.js';
import { RoutingModule, type RoutingOptions } from './routing/routing.module.js';
import { HealthModule } from './health/health.module.js';
import type { IdentityOptions } from './identity/config.js';
import { IdentityModule } from './identity/identity.module.js';
import { JobsModule, type JobsOptions } from './jobs/jobs.module.js';
import type { MailOptions } from './mail/config.js';
import { MailModule } from './mail/mail.module.js';
import { MissionsModule } from './missions/missions.module.js';
import { AvoidZonesModule } from './avoid-zones/avoid-zones.module.js';
import { MissionRoutesModule } from './mission-routes/mission-routes.module.js';
import { RoutesModule } from './routes/routes.module.js';
import { WeatherModule, type WeatherOptions } from './weather/weather.module.js';

export interface AppOptions {
  /** Connection of the API: always `onway_app`. */
  database: DbConnection;
  /** Secret and lifetime of sessions (D-H0-07, D-H0-08). */
  identity: IdentityOptions;
  clock?: Clock;
  /** Altitude source, address search and the per-user altitude limit. Without them the test implementations answer; `main.ts` passes the real ones. */
  geo?: GeoOptions;
  routing?: RoutingOptions;
  /** The calculation queue. Without it the in-memory one answers; `main.ts` and the worker pass pg-boss. */
  jobs?: JobsOptions;
  /** Where uploaded files live. Without it they stay in memory; `main.ts` passes the disk store. */
  files?: FilesOptions;
  /** Weather provider. Without it the test implementation answers; `main.ts` passes the real one. */
  weather?: WeatherOptions;
  /** The `Mailer` port and the origin of its links. Without it the console adapter answers; `main.ts` and the worker pass the ones read from the environment. */
  mail?: Partial<MailOptions>;
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
        MailModule.register(options.mail),
        GeoModule.register(options.geo),
        RoutingModule.register(options.routing),
        JobsModule.register(options.jobs),
        DatabaseModule.register(options.database),
        AuditModule,
        IdentityModule.register(options.identity),
        FilesModule.register(options.files),
        MissionsModule,
        RoutesModule,
        MissionRoutesModule,
        AvoidZonesModule,
        WeatherModule.register(options.weather),
        CommonModule,
        HealthModule,
      ],
      controllers: options.extraControllers ?? [],
    };
  }
}
