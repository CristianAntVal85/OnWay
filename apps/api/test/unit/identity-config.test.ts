import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { identityOptionsFromEnv } from '../../src/identity/config.js';

function secretFile(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'onway-')), 'csrf');
  writeFileSync(file, content);
  return file;
}

describe('identityOptionsFromEnv', () => {
  it('reads the CSRF secret from a file and defaults the session to 12 hours', () => {
    const options = identityOptionsFromEnv({ CSRF_SECRET_FILE: secretFile(`${'x'.repeat(40)}\n`) });
    expect(options.csrfSecret.toString()).toBe('x'.repeat(40));
    expect(options.sessionTtlMs).toBe(12 * 3_600_000);
  });

  it('refuses a secret given inline, a short secret and a nonsensical lifetime', () => {
    expect(() => identityOptionsFromEnv({ CSRF_SECRET: 'x'.repeat(40) })).toThrow('CSRF_SECRET_FILE is not set');
    expect(() => identityOptionsFromEnv({ CSRF_SECRET_FILE: secretFile('short') })).toThrow(/at least 32 bytes/);
    const file = secretFile('y'.repeat(40));
    expect(() => identityOptionsFromEnv({ CSRF_SECRET_FILE: file, SESSION_TTL_HOURS: '0' })).toThrow(/SESSION_TTL_HOURS/);
    expect(() => identityOptionsFromEnv({ CSRF_SECRET_FILE: file, SESSION_TTL_HOURS: 'abc' })).toThrow(/SESSION_TTL_HOURS/);
    expect(identityOptionsFromEnv({ CSRF_SECRET_FILE: file, SESSION_TTL_HOURS: '1.5' }).sessionTtlMs).toBe(5_400_000);
  });
});
