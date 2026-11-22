import { createHmac } from 'node:crypto';
import { normalizeDocument, type DocumentTypeValue } from '@onway/contracts';
import type { SensitiveKeys } from './config.js';

/**
 * Irreversible fingerprint of an identity document (INV-24, doc 05 §7): HMAC-SHA256 with its own key over the type and the normalized
 * number, so `12.345.678-z` and `12345678Z` collide and a DNI never collides with a passport of the same characters.
 */
export class DocumentFingerprint {
  constructor(private readonly keys: Pick<SensitiveKeys, 'fingerprintKey'>) {}

  of(type: DocumentTypeValue, number: string): Buffer {
    return createHmac('sha256', this.keys.fingerprintKey)
      .update(`${type}:${normalizeDocument(number)}`, 'utf8')
      .digest();
  }
}
