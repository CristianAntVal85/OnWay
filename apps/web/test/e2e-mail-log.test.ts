import { describe, expect, it } from 'vitest';
import { lastResetMailTo, parseResetMails, tokenOf } from '../e2e/support/mail-log';

const TOKEN_A = 'abcDEF123-_abcDEF123-_abcDEF123-_abcDEF123-_a';
const TOKEN_B = 'ZYXwvu987-_ZYXwvu987-_ZYXwvu987-_ZYXwvu987-_Z';
const line = (to: string, token: string, locale = 'es', kind = 'password-reset') => JSON.stringify({ event: 'mail', kind, to, locale, link: `http://localhost:18080/reset-password#token=${token}` });

describe('E2E support: reading the console mailer log', () => {
  it('reads the exact line the console mailer writes', () => {
    expect(parseResetMails(line('ana@example.org', TOKEN_A))).toEqual([{ to: 'ana@example.org', locale: 'es', link: `http://localhost:18080/reset-password#token=${TOKEN_A}`, token: TOKEN_A }]);
  });

  it('finds the line among other log lines and behind the prefix of docker compose', () => {
    const text = [
      '{"level":30,"msg":"request completed"}',
      `api-1  | ${line('ana@example.org', TOKEN_A, 'fr')}`,
      'api-1  | [Nest] Mail warning: something',
      '',
      `api  | ${line('luc@example.org', TOKEN_B)}\r`,
    ].join('\n');
    const mails = parseResetMails(text);
    expect(mails.map((m) => [m.to, m.locale, m.token])).toEqual([
      ['ana@example.org', 'fr', TOKEN_A],
      ['luc@example.org', 'es', TOKEN_B],
    ]);
  });

  it('returns the LAST mail to an address, ignoring case and the mail to other people', () => {
    const text = [line('ana@example.org', TOKEN_A), line('luc@example.org', TOKEN_B), line('Ana@Example.org', TOKEN_B)].join('\n');
    expect(lastResetMailTo(text, 'ana@example.org')?.token).toBe(TOKEN_B);
    expect(lastResetMailTo(text, ' ANA@example.org ')?.token).toBe(TOKEN_B);
    expect(lastResetMailTo(text, 'nadie@example.org')).toBeUndefined();
    expect(lastResetMailTo('', 'ana@example.org')).toBeUndefined();
  });

  it('skips lines that are not a well-formed password-reset mail', () => {
    const text = [
      '{"event":"mail","kind":"password-reset","to":"ana@exa',
      line('ana@example.org', TOKEN_A, 'de'),
      line('ana@example.org', TOKEN_A, 'es', 'welcome'),
      JSON.stringify({ event: 'mail', kind: 'password-reset', to: 'ana@example.org', locale: 'es', link: 'http://localhost:18080/reset-password' }),
      JSON.stringify({ event: 'mail', kind: 'password-reset', to: 7, locale: 'es', link: 'x#token=y' }),
      '{"event":"mail"} trailing',
    ].join('\n');
    expect(parseResetMails(text)).toEqual([]);
  });

  it('takes the token from the fragment, never from the query', () => {
    expect(tokenOf(`http://h/reset-password#token=${TOKEN_A}`)).toBe(TOKEN_A);
    expect(tokenOf(`http://h/reset-password?token=${TOKEN_A}`)).toBe('');
    expect(tokenOf('http://h/reset-password#other=1')).toBe('');
  });
});
