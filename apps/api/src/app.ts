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
}

/** Builds the application without starting it, so tests can add middleware before `listen`. */
export async function createApp(options: CreateAppOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(options), { logger: options.logger ?? ['log', 'warn', 'error'] });
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(accessLogMiddleware);
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
