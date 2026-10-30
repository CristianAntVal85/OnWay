import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appConnectionFromEnv, ownerConnectionFromEnv } from '../../src/db/config.js';

describe('ownerConnectionFromEnv', () => {
  it('reads the password from a file and strips the trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onway-'));
    const file = join(dir, 'pw');
    writeFileSync(file, 'not-a-real-secret\n');
    expect(ownerConnectionFromEnv({ DB_OWNER_PASSWORD_FILE: file, DB_HOST: 'db', DB_PORT: '5433' })).toEqual({
      host: 'db',
      port: 5433,
      database: 'onway',
      user: 'onway_owner',
      password: 'not-a-real-secret',
    });
  });

  it('refuses a password given inline: only *_FILE is accepted', () => {
    expect(() => ownerConnectionFromEnv({ DB_OWNER_PASSWORD: 'x' })).toThrow('DB_OWNER_PASSWORD_FILE is not set');
  });
});

describe('appConnectionFromEnv', () => {
  it('is always onway_app and reads its password from a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onway-'));
    const file = join(dir, 'pw');
    writeFileSync(file, 'not-a-real-app-secret\n');
    expect(appConnectionFromEnv({ DB_APP_PASSWORD_FILE: file, DB_OWNER_USER: 'onway_owner', DB_USER: 'postgres' })).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'onway',
      user: 'onway_app',
      password: 'not-a-real-app-secret',
    });
  });

  it('refuses a password given inline', () => {
    expect(() => appConnectionFromEnv({ DB_APP_PASSWORD: 'x' })).toThrow('DB_APP_PASSWORD_FILE is not set');
  });
});
