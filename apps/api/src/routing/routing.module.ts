import { Global, Module, type DynamicModule } from '@nestjs/common';
import { InMemoryRouting } from './in-memory-routing.js';
import { ROUTING_PROVIDER, type RoutingProvider } from './routing.js';

export interface RoutingOptions {
  provider?: RoutingProvider;
}

/**
 * Provides the `RoutingProvider` port to every module. Without options the in-memory double answers (the tests); `main.ts` and
 * the worker always pass the real adapter (`createRoutingProvider`).
 */
@Global()
@Module({})
export class RoutingModule {
  static register(options: RoutingOptions = {}): DynamicModule {
    return {
      module: RoutingModule,
      providers: [{ provide: ROUTING_PROVIDER, useValue: options.provider ?? new InMemoryRouting() }],
      exports: [ROUTING_PROVIDER],
    };
  }
}
