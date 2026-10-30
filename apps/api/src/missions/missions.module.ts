import { Module } from '@nestjs/common';
import { MissionsController } from './missions.controller.js';
import { MissionsService } from './missions.service.js';

/** Missions of the staff: create, read, edit, list and history. The audit writer and the elevation port are global. */
@Module({ controllers: [MissionsController], providers: [MissionsService] })
export class MissionsModule {}
