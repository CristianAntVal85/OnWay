import { Module, type DynamicModule, type Type } from '@nestjs/common';
import type { Clock } from './clock/clock.js';
import { ClockModule } from './clock/clock.module.js';
import { CommonModule } from './common/common.module.js';
import type { DbConnection } from './db/config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import type { IdentityOptions } from './identity/config.js';
import { IdentityModule } from './identity/identity.module.js';

export interface AppOptions {
  /** Connection of the API: always `onway_app`. */
  database: DbConnection;
  /** Secret and lifetime of sessions (D-H0-07, D-H0-08). */
  identity: IdentityOptions;
  clock?: Clock;
  /** Only for tests: controllers of synthetic endpoints (outside the registry) that exercise the guards. */
  extraControllers?: Type<unknown>[];
}

@Module({})
export class AppModule {
  static register(options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [ClockModule.register(options.clock), DatabaseModule.register(options.database), IdentityModule.register(options.identity), CommonModule, HealthModule],
      controllers: options.extraControllers ?? [],
    };
  }
}
