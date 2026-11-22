import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SensitiveKeys } from './config.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The encrypted columns of `rescuer_sensitive`: each one is bound to its own name. */
export type SensitiveField = 'document' | 'address';

/**
 * AES-256-GCM per field (doc 05 §7): `nonce (12) ‖ ciphertext ‖ tag (16)`. The additional data is `profile_id ‖ field`, so a value
 * copied to another profile or another column does not decrypt.
 */
export class SensitiveCipher {
  constructor(private readonly keys: Pick<SensitiveKeys, 'encryptionKey' | 'keyId'>) {}

  get keyId(): number {
    return this.keys.keyId;
  }

  encrypt(profileId: string, field: SensitiveField, plaintext: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.keys.encryptionKey, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalData(profileId, field));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  /** Throws when the value was changed, belongs to another profile or field, or was encrypted with another key. */
  decrypt(profileId: string, field: SensitiveField, value: Buffer, keyId: number): string {
    if (keyId !== this.keys.keyId) throw new Error(`no key with id ${keyId}`);
    if (value.length < NONCE_BYTES + TAG_BYTES) throw new Error('encrypted value too short');
    const nonce = value.subarray(0, NONCE_BYTES);
    const tag = value.subarray(value.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.keys.encryptionKey, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(profileId, field));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(value.subarray(NONCE_BYTES, value.length - TAG_BYTES)), decipher.final()]).toString('utf8');
  }
}

const additionalData = (profileId: string, field: SensitiveField) => Buffer.from(`${profileId}‖${field}`, 'utf8');
