import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { OnwayRequest } from './operation.js';

const ACCEPTED = /^[A-Za-z0-9_-]{8,64}$/;

/** Gives every request an id (kept if the caller sent a well-formed `X-Request-Id`) and echoes it in the response. */
export function requestIdMiddleware(req: OnwayRequest, res: Response, next: NextFunction): void {
  const sent = req.header('x-request-id');
  req.requestId = sent && ACCEPTED.test(sent) ? sent : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
