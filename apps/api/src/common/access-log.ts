import { Logger } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { OnwayRequest } from './operation.js';

const logger = new Logger('Http');

/**
 * One line per request: id, method, path, status and time. It writes `req.path`, never the query string (INV-30, D-H1-10):
 * `getEnvironment` carries the device position there, and the log must not keep it. Health checks (every few seconds) are left out.
 */
export function accessLogMiddleware(req: OnwayRequest, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.endsWith('/health')) return;
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    logger.log(`[${req.requestId}] ${req.method} ${req.path} ${res.statusCode} ${ms} ms`);
  });
  next();
}
