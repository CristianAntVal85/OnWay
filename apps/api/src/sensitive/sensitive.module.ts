import { randomBytes } from 'node:crypto';
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { sensitiveKeysFromSecrets, type SensitiveKeys } from './config.js';
import { DocumentFingerprint } from './document-fingerprint.js';
import { SensitiveCipher } from './sensitive-cipher.js';

/**
 * The cipher and the fingerprint of the sensitive data, for every module. `main.ts` passes the keys read from the secret files
 * (`sensitiveKeysFromEnv`); without them, as in tests, each app makes random keys that live only in memory.
 */
@Global()
@Module({})
export class SensitiveModule {
  static register(keys?: SensitiveKeys): DynamicModule {
    const resolved = keys ?? sensitiveKeysFromSecrets(randomBytes(32), randomBytes(32));
    return {
      module: SensitiveModule,
      providers: [
        { provide: SensitiveCipher, useValue: new SensitiveCipher(resolved) },
        { provide: DocumentFingerprint, useValue: new DocumentFingerprint(resolved) },
      ],
      exports: [SensitiveCipher, DocumentFingerprint],
    };
  }
}
