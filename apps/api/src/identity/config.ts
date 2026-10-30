import { readSecret, type Env } from '../db/config.js';

export const IDENTITY_OPTIONS = Symbol('IDENTITY_OPTIONS');

export interface IdentityOptions {
  /** HMAC key of the CSRF tokens (D-H0-08). Read from a file, never from the repository (rule 10). */
  csrfSecret: Buffer;
  /** Lifetime of a session (D-H0-07). */
  sessionTtlMs: number;
}

const MIN_SECRET_BYTES = 32;
const DEFAULT_TTL_HOURS = 12;

export function identityOptionsFromEnv(env: Env = process.env): IdentityOptions {
  const secret = Buffer.from(readSecret(env, 'CSRF_SECRET'), 'utf8');
  if (secret.length < MIN_SECRET_BYTES) throw new Error(`the CSRF secret must have at least ${MIN_SECRET_BYTES} bytes`);
  const hours = Number(env.SESSION_TTL_HOURS ?? DEFAULT_TTL_HOURS);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) throw new Error('SESSION_TTL_HOURS must be between 0 and 720');
  return { csrfSecret: secret, sessionTtlMs: Math.round(hours * 3_600_000) };
}
