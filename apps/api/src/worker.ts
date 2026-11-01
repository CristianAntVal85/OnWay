import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from './app.module.js';
import { SystemClock } from './clock/clock.js';
import { appConnectionFromEnv } from './db/config.js';
import { DatabaseService } from './db/database.service.js';
import { createFileStorage } from './files/config.js';
import { createElevationProvider, createGeocodingProvider } from './geo/config.js';
import { identityOptionsFromEnv } from './identity/config.js';
import { JobRunner } from './jobs/job-runner.js';
import { PgBossQueue } from './jobs/pg-boss-queue.js';
import { CALCULATE_QUEUE } from './jobs/queue.js';
import { createRoutingProvider } from './routing/config.js';
import { createWeatherProvider } from './weather/config.js';

// The second entry point of the same code (AD-05, D-H3-01): it takes the calculation jobs from the queue and carries them out. It
// mounts no HTTP route; the only port it opens is the health check of the compose.
const clock = new SystemClock();
const database = appConnectionFromEnv();
const queue = new PgBossQueue({ connection: database });
const app = await NestFactory.createApplicationContext(
  AppModule.register({
    database,
    identity: identityOptionsFromEnv(),
    clock,
    geo: { elevation: createElevationProvider(process.env), geocoding: createGeocodingProvider(clock, process.env) },
    files: { storage: createFileStorage() },
    weather: { provider: createWeatherProvider(process.env) },
    routing: { provider: createRoutingProvider(process.env) },
    jobs: { queue },
  }),
  { logger: ['log', 'warn', 'error'] },
);
app.enableShutdownHooks();

const runner = app.get(JobRunner);
await queue.start();
await queue.work(CALCULATE_QUEUE, (job) => runner.process(job));

// 200 while the database answers; the compose restarts a worker that stops answering.
const databaseService = app.get(DatabaseService);
const health = createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  databaseService
    .withAnonymous((tx) => tx.execute(sql`SELECT 1`))
    .then(() => response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'))
    .catch(() => response.writeHead(503).end());
});
health.listen(Number(process.env.WORKER_PORT ?? 3001), process.env.HOST ?? '0.0.0.0');
console.log('worker ready: taking calculation jobs');
