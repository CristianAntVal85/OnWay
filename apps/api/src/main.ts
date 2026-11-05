import 'reflect-metadata';
import { createApp } from './app.js';
import { SystemClock } from './clock/clock.js';
import { trustedProxiesFromEnv } from './common/client-ip.js';
import { appConnectionFromEnv } from './db/config.js';
import { createFileStorage } from './files/config.js';
import { createElevationProvider, createGeocodingProvider } from './geo/config.js';
import { identityOptionsFromEnv } from './identity/config.js';
import { mailOptionsFromEnv } from './mail/config.js';
import { PgBossQueue } from './jobs/pg-boss-queue.js';
import { createRoutingProvider } from './routing/config.js';
import { createWeatherProvider } from './weather/config.js';

// The real adapters, always: tests inject their own through `createApp`, the running image never swaps in fakes (D-H1-15).
const clock = new SystemClock();
const database = appConnectionFromEnv();
// The API only puts jobs in the queue; the worker (worker.ts) takes them and looks after the ones whose worker died.
const queue = new PgBossQueue({ connection: database, supervise: false });
await queue.start();
const app = await createApp({
  database,
  identity: identityOptionsFromEnv(),
  clock,
  mail: mailOptionsFromEnv(),
  geo: { elevation: createElevationProvider(process.env), geocoding: createGeocodingProvider(clock, process.env) },
  files: { storage: createFileStorage() },
  routing: { provider: createRoutingProvider(process.env) },
  jobs: { queue },
  weather: { provider: createWeatherProvider(process.env) },
  trustProxy: trustedProxiesFromEnv(process.env),
});
const port = Number(process.env.PORT ?? 3000);
await app.listen(port, process.env.HOST ?? '0.0.0.0');
