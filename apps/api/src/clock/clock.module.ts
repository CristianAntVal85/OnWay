import { Global, Module, type DynamicModule } from '@nestjs/common';
import { CLOCK, SystemClock, type Clock } from './clock.js';

/** Provides the `Clock` port to every module; tests pass a fixed clock. */
@Global()
@Module({})
export class ClockModule {
  static register(clock: Clock = new SystemClock()): DynamicModule {
    return { module: ClockModule, providers: [{ provide: CLOCK, useValue: clock }], exports: [CLOCK] };
  }
}
