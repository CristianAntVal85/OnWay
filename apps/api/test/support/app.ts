import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp, API_PREFIX, type CreateAppOptions } from '../../src/app.js';
import type { IdentityOptions } from '../../src/identity/config.js';
import { RecordingMailer } from './mailer.js';

export interface TestApp {
  app: NestExpressApplication;
  identity: IdentityOptions;
  /** What the app "sent" by mail: the links a person would have received. */
  mailer: RecordingMailer;
  baseUrl: string;
  close(): Promise<void>;
}

/** The mailer is always the recording one (`TestApp.mailer`); a test that needs another origin for the links passes `publicBaseUrl`. */
export type StartOptions = Omit<CreateAppOptions, 'identity' | 'mail'> & { identity?: Partial<IdentityOptions>; publicBaseUrl?: string };

/** A fresh random secret per run: tests never carry one (rule 10). */
export const testIdentity = (overrides: Partial<IdentityOptions> = {}): IdentityOptions => ({
  csrfSecret: randomBytes(32),
  sessionTtlMs: 12 * 3_600_000,
  ...overrides,
});

export async function startApp(options: StartOptions): Promise<TestApp> {
  // Every app closes with its own shutdown hooks (signal listeners): a test process holds many apps in a row.
  process.setMaxListeners(100);
  const identity = testIdentity(options.identity);
  const mailer = new RecordingMailer();
  const { publicBaseUrl = 'http://localhost:8080', ...rest } = options;
  const app = await createApp({ logger: process.env.TEST_LOGS ? ['error', 'warn'] : false, ...rest, identity, mail: { mailer, publicBaseUrl } });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, identity, mailer, baseUrl: `http://127.0.0.1:${port}/${API_PREFIX}`, close: () => app.close() };
}

/** What a browser would keep after `login`: the session cookie (sent by hand: fetch has no cookie jar) and the CSRF token. */
export interface Session {
  cookie: string;
  csrf: string;
  setCookie: string;
  body: { user: Record<string, unknown>; csrfToken: string };
}

export async function login(app: TestApp, email: string, password: string): Promise<{ response: Response; session?: Session }> {
  const response = await fetch(`${app.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) return { response };
  const setCookie = response.headers.getSetCookie()[0]!;
  const body = (await response.clone().json()) as Session['body'];
  return { response, session: { cookie: setCookie.split(';')[0]!, csrf: body.csrfToken, setCookie, body } };
}

/** Logs in and fails the test if it does not work. */
export async function mustLogin(app: TestApp, email: string, password: string): Promise<Session> {
  const { response, session } = await login(app, email, password);
  if (!session) throw new Error(`login failed with ${response.status}: ${await response.text()}`);
  return session;
}

export const withSession = (session: Session, csrf = true): Record<string, string> => ({ cookie: session.cookie, ...(csrf ? { 'x-csrf-token': session.csrf } : {}) });

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
