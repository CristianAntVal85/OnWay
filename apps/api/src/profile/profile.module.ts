import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

/** The rescuer's own profile (H5-perfil) and their courses and skills (H5-habilidades). The cipher comes from the global `SensitiveModule`, the `FileStorage` from `FilesModule`. */
@Module({ controllers: [ProfileController, SkillsController], providers: [ProfileService, SkillsService] })
export class ProfileModule {}
