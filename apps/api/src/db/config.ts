import { readFileSync } from 'node:fs';

export interface DbConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export type Env = Record<string, string | undefined>;

/** Reads a secret from `<name>_FILE`; the repository never holds passwords (rule 10). */
export function readSecret(env: Env, name: string): string {
  const file = env[`${name}_FILE`];
  if (!file) throw new Error(`${name}_FILE is not set`);
  return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
}

function baseConnection(env: Env) {
  return { host: env.DB_HOST ?? 'localhost', port: Number(env.DB_PORT ?? 5432), database: env.DB_NAME ?? 'onway' };
}

/** Connection as the schema owner (migrations and seed). The API never uses this role. */
export function ownerConnectionFromEnv(env: Env = process.env): DbConnection {
  return { ...baseConnection(env), user: env.DB_OWNER_USER ?? 'onway_owner', password: readSecret(env, 'DB_OWNER_PASSWORD') };
}

/** Connection of the API: always `onway_app`, subject to row level security (doc 05 §6.2). */
export function appConnectionFromEnv(env: Env = process.env): DbConnection {
  return { ...baseConnection(env), user: 'onway_app', password: readSecret(env, 'DB_APP_PASSWORD') };
}
