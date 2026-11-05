import { ConsoleMailer } from './console-mailer.js';
import type { Mailer } from './mailer.js';

type Env = Record<string, string | undefined>;

export interface MailOptions {
  mailer: Mailer;
  /** Origin the links point to, without a trailing slash (`http://localhost:8080`). */
  publicBaseUrl: string;
}

export const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:8080';

/**
 * The mail configuration, read at start-up (it fails with a clear message instead of degrading in silence).
 *
 * With `NODE_ENV=production` all three variables are REQUIRED: a missing one stops the start (a deployment must say where its links
 * point and how its mail leaves, never inherit a development default). Outside production they have development defaults.
 *
 * - `MAILER`: only `console` is accepted for now (Resend arrives with the deployment, H7). Development default `console`.
 * - `MAILER_ALLOW_CONSOLE`: `console` with `NODE_ENV=production` starts only with `true` (D-A7): a recovery link must not reach
 *   a production log by oversight. The local stack, the E2E overlay and the CI run the image with `NODE_ENV=production`, so
 *   `infra/compose.yml` sets it; the deployment of H7 will not (it will use Resend). Development default `true`.
 * - `PUBLIC_BASE_URL`: origin of the links, `http(s)://host[:port]` with no path. A trailing slash is dropped. Development default
 *   `http://localhost:8080`; compose sets it from the published port.
 */
export function mailOptionsFromEnv(env: Env = process.env): MailOptions {
  const production = env.NODE_ENV === 'production';
  if (production) {
    const missing = ['MAILER', 'MAILER_ALLOW_CONSOLE', 'PUBLIC_BASE_URL'].filter((name) => !env[name]);
    if (missing.length > 0) {
      throw new Error(
        `With NODE_ENV=production these variables are required and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set (the mail configuration has no production defaults)`,
      );
    }
  }

  const mailer = env.MAILER || 'console';
  if (mailer !== 'console') throw new Error(`MAILER must be "console" (the only mailer available until the deployment), got "${mailer}"`);

  const allowRaw = env.MAILER_ALLOW_CONSOLE || 'true';
  if (allowRaw !== 'true' && allowRaw !== 'false') throw new Error(`MAILER_ALLOW_CONSOLE must be "true" or "false", got "${allowRaw}"`);
  if (production && allowRaw !== 'true') {
    throw new Error('MAILER=console with NODE_ENV=production writes recovery links to the log: it starts only with MAILER_ALLOW_CONSOLE=true');
  }

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
