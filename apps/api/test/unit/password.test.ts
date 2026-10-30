import { describe, expect, it } from 'vitest';
import { dummyHash, hashPassword, verifyPassword } from '../../src/identity/password.js';

describe('Argon2id passwords (D-H0-10, RF-101)', () => {
  it('writes a PHC string with the planned parameters and a different salt each time', async () => {
    const a = await hashPassword('fictitious-password-1');
    const b = await hashPassword('fictitious-password-1');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('fictitious-password-1');
  });

  it('round trip: the right password verifies, a wrong or similar one does not', async () => {
    const hash = await hashPassword('fictitious-password-1');
    expect(await verifyPassword('fictitious-password-1', hash)).toBe(true);
    expect(await verifyPassword('fictitious-password-2', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('Fictitious-password-1', hash)).toBe(false);
  });

  it('verifies with the parameters written in the stored string, not the current ones', async () => {
    // Different m, t and tag length than the defaults: a future change of parameters must not lock anyone out.
    const { argon2Sync } = await import('node:crypto');
    const salt = Buffer.from('0123456789abcdef');
    const tag = argon2Sync('argon2id', { message: Buffer.from('another-fictitious-one'), nonce: salt, memory: 8192, passes: 3, parallelism: 1, tagLength: 24 });
    const stored = `$argon2id$v=19$m=8192,t=3,p=1$${salt.toString('base64').replace(/=+$/, '')}$${tag.toString('base64').replace(/=+$/, '')}`;
    expect(await verifyPassword('another-fictitious-one', stored)).toBe(true);
    expect(await verifyPassword('another-fictitious-two', stored)).toBe(false);
  });

  it('answers false, without throwing, for a stored value it cannot read (an anonymized account holds "!")', async () => {
    for (const stored of ['!', '', 'not-a-real-hash', '$argon2i$v=19$m=1,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaA']) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });

  it('keeps a throwaway hash, readable by the same verifier, to equalize the cost of an unknown email', async () => {
    const dummy = await dummyHash();
    expect(await dummyHash()).toBe(dummy);
    expect(dummy).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('anything', dummy)).toBe(false);
  });
});
