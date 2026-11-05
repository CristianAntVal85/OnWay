import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { LogLevel } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, type AppOptions } from './app.module.js';
import { accessLogMiddleware } from './common/access-log.js';
import { requestIdMiddleware } from './common/request-id.js';

export const API_PREFIX = 'api/v1';

export interface CreateAppOptions extends AppOptions {
  logger?: LogLevel[] | false;
  /**
   * Express's `trust proxy`: which connections may tell the client's address with `X-Forwarded-For` (the public rate limit counts
   * clients by it, `common/client-ip.ts`). Unset means nobody: the address is the socket's and the header is ignored. `main.ts` passes
   * the private ranges (Caddy is the only thing that reaches the `api`); tests pass `loopback` or leave it unset.
   */
  trustProxy?: boolean | number | string | string[];
}

/** Builds the application without starting it, so tests can add middleware before `listen`. */
export async function createApp(options: CreateAppOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), { logger: options.logger ?? ['log', 'warn', 'error'] });
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? false);
  app.use(requestIdMiddleware);
  app.use(accessLogMiddleware);
  // After the request id, so that a body the parser refuses is answered with one. A line sent by the client (draw, edit) has up to
  // 20 000 vertices: about 0.6 MB of JSON, over the 100 kB of Express's default.
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
