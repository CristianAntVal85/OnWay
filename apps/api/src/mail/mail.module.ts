import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConsoleMailer } from './console-mailer.js';
import { DEFAULT_PUBLIC_BASE_URL, type MailOptions } from './config.js';
import { MAILER } from './mailer.js';

export const MAIL_PUBLIC_BASE_URL = Symbol('MAIL_PUBLIC_BASE_URL');

/**
 * Provides the `Mailer` port and the origin of the links to every module (the identity service of T4 injects them). Without
 * options the console adapter answers; `main.ts` and the worker pass the ones read from the environment (`mailOptionsFromEnv`),
 * and tests pass a `RecordingMailer`.
 */
@Global()
@Module({})
export class MailModule {
  static register(options: Partial<MailOptions> = {}): DynamicModule {
    return {
      module: MailModule,
      providers: [
        { provide: MAILER, useValue: options.mailer ?? new ConsoleMailer() },
        { provide: MAIL_PUBLIC_BASE_URL, useValue: options.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL },
      ],
      exports: [MAILER, MAIL_PUBLIC_BASE_URL],
    };
  }
}
