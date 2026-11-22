// Cifrado y huella de los datos sensibles (H5-perfil T2, doc 04 §6.3, doc 05 §7, INV-18, INV-24).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sensitiveKeysFromEnv, sensitiveKeysFromSecrets } from '../../src/sensitive/config.js';
import { DocumentFingerprint } from '../../src/sensitive/document-fingerprint.js';
import { SensitiveCipher } from '../../src/sensitive/sensitive-cipher.js';

const keys = () => sensitiveKeysFromSecrets(randomBytes(48), randomBytes(48));

function secretFile(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'onway-')), 'key');
  writeFileSync(file, content);
  return file;
}

describe('SensitiveCipher', () => {
  const profile = randomUUID();

  it('decrypts what it encrypted; the stored bytes are nonce, ciphertext and tag, and never contain the plaintext', () => {
    const cipher = new SensitiveCipher(keys());
    const value = cipher.encrypt(profile, 'document', '12345678Z');
    expect(value.length).toBe(12 + '12345678Z'.length + 16);
    expect(value.includes(Buffer.from('12345678Z'))).toBe(false);
    expect(cipher.decrypt(profile, 'document', value, cipher.keyId)).toBe('12345678Z');
    // Un nonce nuevo cada vez: el mismo dato no da los mismos bytes.
    expect(cipher.encrypt(profile, 'document', '12345678Z').equals(value)).toBe(false);
  });

  it('a value copied to another profile or another field does not decrypt (additional data)', () => {
    const cipher = new SensitiveCipher(keys());
    const value = cipher.encrypt(profile, 'address', '{"street":"Calle Inventada"}');
    expect(() => cipher.decrypt(randomUUID(), 'address', value, cipher.keyId)).toThrow();
    expect(() => cipher.decrypt(profile, 'document', value, cipher.keyId)).toThrow();
  });

  it('a changed byte, another key or an unknown key id do not decrypt', () => {
    const shared = keys();
    const cipher = new SensitiveCipher(shared);
    const value = cipher.encrypt(profile, 'document', 'X1234567L');
    const tampered = Buffer.from(value);
    tampered[14] = tampered[14]! ^ 0x01;
    expect(() => cipher.decrypt(profile, 'document', tampered, cipher.keyId)).toThrow();
    expect(() => new SensitiveCipher(keys()).decrypt(profile, 'document', value, 1)).toThrow();
    expect(() => cipher.decrypt(profile, 'document', value, 2)).toThrow(/no key with id 2/);
    expect(() => cipher.decrypt(profile, 'document', Buffer.alloc(10), 1)).toThrow(/too short/);
  });
});

describe('DocumentFingerprint', () => {
  it('the same document written differently gives the same fingerprint; another type or number, another one', () => {
    const fingerprint = new DocumentFingerprint(keys());
    const a = fingerprint.of('dni', '12345678Z');
    expect(fingerprint.of('dni', '12.345.678-z').equals(a)).toBe(true);
    expect(fingerprint.of('dni', ' 12345678 Z ').equals(a)).toBe(true);
    expect(fingerprint.of('passport', '12345678Z').equals(a)).toBe(false);
    expect(fingerprint.of('dni', '87654321X').equals(a)).toBe(false);
    expect(a.length).toBe(32);
  });

  it('depends on its own key: another organization stack gives another fingerprint, and it is not the encryption key', () => {
    const k = keys();
    expect(k.fingerprintKey.equals(k.encryptionKey)).toBe(false);
    expect(new DocumentFingerprint(keys()).of('dni', '12345678Z').equals(new DocumentFingerprint(k).of('dni', '12345678Z'))).toBe(false);
  });
});

describe('sensitiveKeysFromEnv', () => {
  it('reads both secrets from files and derives two distinct 32-byte keys, even from the same file', () => {
    const file = secretFile(`${'a'.repeat(96)}\n`);
    const k = sensitiveKeysFromEnv({ SENSITIVE_KEY_FILE: file, DOCUMENT_HASH_KEY_FILE: file });
    expect(k.encryptionKey.length).toBe(32);
    expect(k.fingerprintKey.length).toBe(32);
    expect(k.encryptionKey.equals(k.fingerprintKey)).toBe(false);
    expect(k.keyId).toBe(1);
    // Mismo secreto, mismas claves: la API y la semilla cifran igual.
    expect(sensitiveKeysFromEnv({ SENSITIVE_KEY_FILE: file, DOCUMENT_HASH_KEY_FILE: file }).encryptionKey.equals(k.encryptionKey)).toBe(true);
  });

  it('does not start without the files or with a short secret', () => {
    const file = secretFile('a'.repeat(96));
    expect(() => sensitiveKeysFromEnv({ DOCUMENT_HASH_KEY_FILE: file })).toThrow('SENSITIVE_KEY_FILE is not set');
    expect(() => sensitiveKeysFromEnv({ SENSITIVE_KEY_FILE: file })).toThrow('DOCUMENT_HASH_KEY_FILE is not set');
    expect(() => sensitiveKeysFromEnv({ SENSITIVE_KEY_FILE: secretFile('short'), DOCUMENT_HASH_KEY_FILE: file })).toThrow(/at least 32 bytes/);
  });
});
