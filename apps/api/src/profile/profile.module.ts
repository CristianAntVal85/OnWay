import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

/** The rescuer's own profile (H5-perfil). The cipher comes from the global `SensitiveModule`. */
@Module({ controllers: [ProfileController], providers: [ProfileService] })
export class ProfileModule {}
