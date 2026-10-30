import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Response } from 'express';
import { createApp, API_PREFIX, type CreateAppOptions } from '../../src/app.js';
import type { OnwayRequest, Principal } from '../../src/common/operation.js';

export interface TestApp {
  app: NestExpressApplication;
  baseUrl: string;
  close(): Promise<void>;
}

/** Test-only authenticator: a JSON `Principal` in `x-test-principal` stands for the session middleware of T5. */
function fakePrincipal(req: OnwayRequest, _res: Response, next: NextFunction): void {
  const header = req.header('x-test-principal');
  if (header) req.principal = JSON.parse(header) as Principal;
  next();
}

export async function startApp(options: CreateAppOptions): Promise<TestApp> {
  const app = await createApp({ logger: false, ...options });
  app.use(fakePrincipal);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}/${API_PREFIX}`, close: () => app.close() };
}

export const asPrincipal = (principal: Principal) => ({ 'x-test-principal': JSON.stringify(principal) });

/** Every route Express has mounted, as `METHOD /path` (Nest registers them directly on the Express router). */
export function mountedRoutes(app: NestExpressApplication): string[] {
  const router = (app.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
  const routes: string[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) routes.push(`${method.toUpperCase()} ${layer.route.path}`);
  }
  return routes.sort();
}
