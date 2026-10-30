import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AUTHENTICATOR } from '../common/authenticator.js';
import { AuthService } from './auth.service.js';
import { IDENTITY_OPTIONS, type IdentityOptions } from './config.js';
import { IdentityController } from './identity.controller.js';
import { SessionService } from './session.service.js';

@Global()
@Module({})
export class IdentityModule {
  static register(options: IdentityOptions): DynamicModule {
    return {
      module: IdentityModule,
      controllers: [IdentityController],
      providers: [{ provide: IDENTITY_OPTIONS, useValue: options }, SessionService, AuthService, { provide: AUTHENTICATOR, useExisting: SessionService }],
      exports: [AUTHENTICATOR],
    };
  }
}
