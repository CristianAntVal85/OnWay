import { describe, expect, it } from 'vitest';
import { CertificateSigner } from '../../src/files/certificate-links.js';

const key = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-22T10:00:00Z');
const grant = { fileId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222', expiresAt: new Date(NOW.getTime() + 300_000) };

describe('CertificateSigner (D-S2)', () => {
  it('a token verifies for its user before it expires, and only the characters the contract allows', () => {
    const signer = new CertificateSigner(key);
    const token = signer.sign(grant);
    expect(token).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(signer.verify(token, grant.userId, NOW)).toEqual(grant);
  });

  it('is null once expired (the instant itself included), for another user and with another key', () => {
    const signer = new CertificateSigner(key);
    const token = signer.sign(grant);
    expect(signer.verify(token, grant.userId, new Date(grant.expiresAt.getTime() - 1))).not.toBeNull();
    expect(signer.verify(token, grant.userId, grant.expiresAt)).toBeNull();
    expect(signer.verify(token, '33333333-3333-4333-8333-333333333333', NOW)).toBeNull();
    expect(new CertificateSigner(Buffer.alloc(32, 8)).verify(token, grant.userId, NOW)).toBeNull();
  });

  it('is null for a tampered payload or signature and for garbage', () => {
    const signer = new CertificateSigner(key);
    const [payload, signature] = signer.sign(grant).split('.') as [string, string];
    const forged = Buffer.from(Buffer.from(payload, 'base64url').toString().replace('1111', '9999')).toString('base64url');
    expect(signer.verify(`${forged}.${signature}`, grant.userId, NOW)).toBeNull();
    expect(signer.verify(`${payload}.${signature.slice(0, -2)}AA`, grant.userId, NOW)).toBeNull();
    for (const bad of ['', '.', 'a.b.c', 'abc', `${payload}.`]) expect(signer.verify(bad, grant.userId, NOW)).toBeNull();
  });

  it('two signers without a key do not accept each other’s tokens (the key is random per process)', () => {
    expect(new CertificateSigner().verify(new CertificateSigner().sign(grant), grant.userId, NOW)).toBeNull();
  });
});
