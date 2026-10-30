import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { CLOCK, SystemClock, type Clock } from './clock/clock.js';
import { CommonModule } from './common/common.module.js';
import type { DbConnection } from './db/config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';

export interface AppOptions {
  /** Connection of the API: always `onway_app`. */
  database: DbConnection;
  clock?: Clock;
  /** Only for tests: controllers that exercise the guards with operations the milestone already allows. */
  extraControllers?: Type<unknown>[];
}

@Module({})
export class AppModule {
  static register(options: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule.register(options.database), CommonModule, HealthModule],
      controllers: options.extraControllers ?? [],
      providers: [{ provide: CLOCK, useValue: options.clock ?? new SystemClock() }],
      exports: [CLOCK],
    };
  }
}
