import { Global, Module, type DynamicModule } from '@nestjs/common';
import { CLOCK, type Clock } from '../clock/clock.js';
import { InMemoryWeatherProvider } from './in-memory-weather.js';
import { WeatherController } from './weather.controller.js';
import { WeatherHealth } from './weather-health.js';
import { WeatherService } from './weather.service.js';
import { WEATHER_PROVIDER, type WeatherProvider } from './weather-provider.js';

export interface WeatherOptions {
  provider?: WeatherProvider;
}

/**
 * Mounts `getEnvironment` and provides the `WeatherProvider` port and the passive health of the provider (the health
 * check reads it). Without options the test implementation answers; `main.ts` always passes the real one.
 */
@Global()
@Module({})
export class WeatherModule {
  static register(options: WeatherOptions = {}): DynamicModule {
    return {
      module: WeatherModule,
      controllers: [WeatherController],
      providers: [
        { provide: WEATHER_PROVIDER, useFactory: (clock: Clock) => options.provider ?? new InMemoryWeatherProvider(clock), inject: [CLOCK] },
        { provide: WeatherHealth, useFactory: (clock: Clock) => new WeatherHealth(clock), inject: [CLOCK] },
        WeatherService,
      ],
      exports: [WEATHER_PROVIDER, WeatherHealth],
    };
  }
}
