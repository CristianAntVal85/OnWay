import 'reflect-metadata';
import { createApp } from './app.js';
import { SystemClock } from './clock/clock.js';
import { appConnectionFromEnv } from './db/config.js';
import { createElevationProvider, createGeocodingProvider } from './geo/config.js';
import { identityOptionsFromEnv } from './identity/config.js';
import { createWeatherProvider } from './weather/config.js';

// The real adapters, always: tests inject their own through `createApp`, the running image never swaps in fakes (D-H1-15).
const clock = new SystemClock();
const app = await createApp({
  database: appConnectionFromEnv(),
  identity: identityOptionsFromEnv(),
  clock,
  geo: { elevation: createElevationProvider(process.env), geocoding: createGeocodingProvider(clock, process.env) },
  weather: { provider: createWeatherProvider(process.env) },
});
const port = Number(process.env.PORT ?? 3000);
await app.listen(port, process.env.HOST ?? '0.0.0.0');
