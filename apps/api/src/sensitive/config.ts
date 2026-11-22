import { hkdfSync } from 'node:crypto';
import { readSecret, type Env } from '../db/config.js';

/** Keys of the sensitive data (doc 04 §6.3, doc 05 §7). They live in secret files, outside the database and its backups. */
export interface SensitiveKeys {
  /** AES-256-GCM key of `document_enc` and `address_enc`. */
  encryptionKey: Buffer;
  /** Which key `encryptionKey` is (`rescuer_sensitive.key_id`), so that it can be rotated later. */
  keyId: number;
  /** HMAC-SHA256 key of `document_hash` (INV-24): a different key from the encryption one. */
  fingerprintKey: Buffer;
}

const MIN_SECRET_BYTES = 32;
const KEY_ID = 1;

/**
 * D-P1: the secret files hold random text like the other secrets of `gen-secrets.sh`; each use gets its own 32-byte key through
 * HKDF-SHA256 with a distinct label, so the two keys stay independent even if someone points both variables at the same file.
 */
export function deriveKey(secret: Buffer, label: string): Buffer {
  if (secret.length < MIN_SECRET_BYTES) throw new Error(`a sensitive data secret must have at least ${MIN_SECRET_BYTES} bytes`);
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `onway/${label}/v1`, 32));
}

export function sensitiveKeysFromSecrets(encryptionSecret: Buffer, fingerprintSecret: Buffer): SensitiveKeys {
  return { encryptionKey: deriveKey(encryptionSecret, 'sensitive-data'), keyId: KEY_ID, fingerprintKey: deriveKey(fingerprintSecret, 'document-fingerprint') };
}

/** `SENSITIVE_KEY_FILE` and `DOCUMENT_HASH_KEY_FILE`. Without them the process does not start: it never falls back to a made-up key. */
export function sensitiveKeysFromEnv(env: Env = process.env): SensitiveKeys {
  return sensitiveKeysFromSecrets(Buffer.from(readSecret(env, 'SENSITIVE_KEY'), 'utf8'), Buffer.from(readSecret(env, 'DOCUMENT_HASH_KEY'), 'utf8'));
}
