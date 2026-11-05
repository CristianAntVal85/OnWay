import { describe, expect, it } from 'vitest';
import { ConsoleMailer } from '../../src/mail/console-mailer.js';
import { DEFAULT_PUBLIC_BASE_URL, mailOptionsFromEnv } from '../../src/mail/config.js';
import { passwordResetLink } from '../../src/mail/links.js';
import { RecordingMailer } from '../support/mailer.js';

const lines = () => {
  const written: string[] = [];
  return { written, write: (line: string) => written.push(line) };
};
const warnings = () => {
  const warned: string[] = [];
  return { warned, warn: (message: string) => warned.push(message) };
};

describe('ConsoleMailer', () => {
  it('writes ONE JSON line with exactly event, kind, to, locale and link, in that order', async () => {
    const out = lines();
    await new ConsoleMailer(out.write).send({ to: 'ana@example.org', kind: 'password-reset', locale: 'fr', link: 'http://localhost:8080/reset-password#token=abc' });
    expect(out.written).toEqual(['{"event":"mail","kind":"password-reset","to":"ana@example.org","locale":"fr","link":"http://localhost:8080/reset-password#token=abc"}']);
    expect(out.written[0]).not.toContain('\n');
    expect(Object.keys(JSON.parse(out.written[0]!))).toEqual(['event', 'kind', 'to', 'locale', 'link']);
  });

  it('writes nothing beyond the fixed fields even if the caller passes more', async () => {
    const out = lines();
    const message = { to: 'a@example.org', kind: 'password-reset', locale: 'es', link: 'http://x/y#token=t', secret: 'nope' } as const;
    await new ConsoleMailer(out.write).send(message);
    expect(Object.keys(JSON.parse(out.written[0]!))).toEqual(['event', 'kind', 'to', 'locale', 'link']);
  });

  it('stays on one line when a field holds a line break (JSON escapes it)', async () => {
    const out = lines();
    await new ConsoleMailer(out.write).send({ to: 'a\nb@example.org', kind: 'password-reset', locale: 'es', link: 'http://x/y' });
    expect(out.written[0]).not.toContain('\n');
    expect(JSON.parse(out.written[0]!).to).toBe('a\nb@example.org');
  });
});

describe('RecordingMailer', () => {
  it('keeps what was sent and finds the last message to an address', async () => {
    const mailer = new RecordingMailer();
    await mailer.send({ to: 'a@example.org', kind: 'password-reset', locale: 'es', link: 'l1' });
    await mailer.send({ to: 'b@example.org', kind: 'password-reset', locale: 'fr', link: 'l2' });
    await mailer.send({ to: 'a@example.org', kind: 'password-reset', locale: 'es', link: 'l3' });
    expect(mailer.sent).toHaveLength(3);
    expect(mailer.lastTo('a@example.org')?.link).toBe('l3');
    expect(mailer.lastTo('z@example.org')).toBeUndefined();
    mailer.clear();
    expect(mailer.sent).toEqual([]);
  });
});

describe('passwordResetLink', () => {
  it('puts the token in the fragment, never in the query', () => {
    const link = passwordResetLink('http://localhost:8080', 'abc123');
    expect(link).toBe('http://localhost:8080/reset-password#token=abc123');
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe('#token=abc123');
  });

  it('keeps a base64url token intact (letters, digits, - and _)', () => {
    const token = 'AZaz09-_AZaz09-_AZaz09-_AZaz09-_AZaz09-_AZa';
    const link = passwordResetLink('https://onway.example.org', token);
    expect(new URL(link).hash).toBe(`#token=${token}`);
    expect(new URLSearchParams(new URL(link).hash.slice(1)).get('token')).toBe(token);
  });

  it('does not double the slash when the base keeps a path-less origin', () => {
    expect(passwordResetLink('https://onway.example.org', 't')).toBe('https://onway.example.org/reset-password#token=t');
  });
});

describe('mailOptionsFromEnv', () => {
  it('outside production defaults to the console, http://localhost:8080 and no warning', () => {
    const w = warnings();
    const options = mailOptionsFromEnv({}, w.warn);
    expect(options.mailer).toBeInstanceOf(ConsoleMailer);
    expect(options.publicBaseUrl).toBe(DEFAULT_PUBLIC_BASE_URL);
    expect(DEFAULT_PUBLIC_BASE_URL).toBe('http://localhost:8080');
    expect(w.warned).toEqual([]);
  });

  it('refuses a MAILER other than console', () => {
    expect(() => mailOptionsFromEnv({ MAILER: 'resend' })).toThrow(/MAILER must be "console"/);
    expect(() => mailOptionsFromEnv({ MAILER: 'smtp', NODE_ENV: 'production', MAILER_ALLOW_CONSOLE: 'true' })).toThrow(/MAILER must be "console"/);
    expect(() => mailOptionsFromEnv({ MAILER: '' })).not.toThrow();
  });

  it('refuses console in production when the switch is explicitly off', () => {
    const env = { NODE_ENV: 'production', MAILER: 'console', PUBLIC_BASE_URL: 'https://onway.example.org' };
    expect(() => mailOptionsFromEnv({ ...env, MAILER_ALLOW_CONSOLE: 'false' })).toThrow(/MAILER_ALLOW_CONSOLE=true/);
    expect(mailOptionsFromEnv({ ...env, MAILER_ALLOW_CONSOLE: 'true' }).mailer).toBeInstanceOf(ConsoleMailer);
  });

  it('refuses a switch that is neither true nor false', () => {
    expect(() => mailOptionsFromEnv({ MAILER_ALLOW_CONSOLE: 'yes' })).toThrow(/MAILER_ALLOW_CONSOLE must be "true" or "false"/);
  });

  it('in production with no variables (the compose of T2) starts with the defaults and warns about each one', () => {
    const w = warnings();
    const options = mailOptionsFromEnv({ NODE_ENV: 'production' }, w.warn);
    expect(options.mailer).toBeInstanceOf(ConsoleMailer);
    expect(options.publicBaseUrl).toBe('http://localhost:8080');
    expect(w.warned.join('\n')).toMatch(/MAILER_ALLOW_CONSOLE/);
    expect(w.warned.join('\n')).toMatch(/PUBLIC_BASE_URL/);
    expect(w.warned.join('\n')).toMatch(/default/);
  });

  it('in production with everything set explicitly does not warn', () => {
    const w = warnings();
    mailOptionsFromEnv({ NODE_ENV: 'production', MAILER: 'console', MAILER_ALLOW_CONSOLE: 'true', PUBLIC_BASE_URL: 'https://onway.example.org' }, w.warn);
    expect(w.warned).toEqual([]);
  });

  it('accepts http and https origins and drops a trailing slash', () => {
    expect(mailOptionsFromEnv({ PUBLIC_BASE_URL: 'https://onway.example.org/' }).publicBaseUrl).toBe('https://onway.example.org');
    expect(mailOptionsFromEnv({ PUBLIC_BASE_URL: 'http://localhost:18080' }).publicBaseUrl).toBe('http://localhost:18080');
    expect(mailOptionsFromEnv({ PUBLIC_BASE_URL: 'https://onway.example.org///' }).publicBaseUrl).toBe('https://onway.example.org');
  });

  it.each([
    'not a url',
    'ftp://onway.example.org',
    'javascript:alert(1)',
    'onway.example.org',
    'https://onway.example.org/app',
    'https://onway.example.org?x=1',
    'https://onway.example.org/#frag',
    'https://user:pw@onway.example.org',
  ])('refuses PUBLIC_BASE_URL %s', (value) => {
    expect(() => mailOptionsFromEnv({ PUBLIC_BASE_URL: value })).toThrow(/PUBLIC_BASE_URL/);
  });
});
