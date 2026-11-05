import { Logger } from '@nestjs/common';
import { ConsoleMailer } from './console-mailer.js';
import type { Mailer } from './mailer.js';

type Env = Record<string, string | undefined>;

export interface MailOptions {
  mailer: Mailer;
  /** Origin the links point to, without a trailing slash (`http://localhost:8080`). */
  publicBaseUrl: string;
}

export const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:8080';

const defaultWarn = (message: string) => new Logger('Mail').warn(message);

/**
 * The mail configuration, read at start-up (it fails with a clear message instead of degrading in silence):
 *
 * - `MAILER`: only `console` is accepted for now (Resend arrives with the deployment, H7). Default `console`.
 * - `MAILER_ALLOW_CONSOLE`: `console` with `NODE_ENV=production` starts only with `true` (D-A7): a recovery link must not reach
 *   a production log by oversight. The local stack, the E2E overlay and the CI run the image with `NODE_ENV=production`, so
 *   they set it; the deployment of H7 will not. Default `true`.
 * - `PUBLIC_BASE_URL`: origin of the links, `http(s)://host[:port]` with no path. A trailing slash is dropped. Default `http://localhost:8080`.
 *
 * TEMPORARY (H5-acceso T2 to T8): `compose.yml` does not set these three yet, and its `api` and `worker` run with
 * `NODE_ENV=production`, so the defaults also apply there, with a warning. T8 sets them in compose and removes the production defaults.
 */
export function mailOptionsFromEnv(env: Env = process.env, warn: (message: string) => void = defaultWarn): MailOptions {
  const production = env.NODE_ENV === 'production';
  const note = (name: string, value: string) => {
    if (production) warn(`${name} is not set: using the default "${value}" (T8 of H5-acceso sets it in compose)`);
  };

  const mailer = env.MAILER || 'console';
  if (!env.MAILER) note('MAILER', 'console');
  if (mailer !== 'console') throw new Error(`MAILER must be "console" (the only mailer available until the deployment), got "${mailer}"`);

  const allowRaw = env.MAILER_ALLOW_CONSOLE || 'true';
  if (!env.MAILER_ALLOW_CONSOLE) note('MAILER_ALLOW_CONSOLE', 'true');
  if (allowRaw !== 'true' && allowRaw !== 'false') throw new Error(`MAILER_ALLOW_CONSOLE must be "true" or "false", got "${allowRaw}"`);
  if (production && allowRaw !== 'true') {
    throw new Error('MAILER=console with NODE_ENV=production writes recovery links to the log: it starts only with MAILER_ALLOW_CONSOLE=true');
  }

  if (!env.PUBLIC_BASE_URL) note('PUBLIC_BASE_URL', DEFAULT_PUBLIC_BASE_URL);
  const publicBaseUrl = normalizeBaseUrl(env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL);

  return { mailer: new ConsoleMailer(), publicBaseUrl };
}

function normalizeBaseUrl(value: string): string {
  const message = `PUBLIC_BASE_URL must be an http(s) origin such as http://localhost:8080 (no path, query or fragment), got "${value}"`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  const bare = url.pathname.replace(/\/+$/, '') === '' && !url.search && !url.hash && !url.username && !url.password;
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !bare || /[?#]/.test(value)) throw new Error(message);
  return url.origin;
}
