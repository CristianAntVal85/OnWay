import { Module } from '@nestjs/common';
import { MissionLifecycleService } from './mission-lifecycle.service.js';
import { MissionPointsService } from './mission-points.service.js';
import { MissionsController, MyMissionsController } from './missions.controller.js';
import { MissionsService } from './missions.service.js';
import { MyMissionsService } from './my-missions.service.js';

/** Missions of the staff (create, read, edit, list, history, life cycle, points) and the rescuer's read-only views. The audit writer, clock and elevation port are global. */
@Module({ controllers: [MissionsController, MyMissionsController], providers: [MissionsService, MissionLifecycleService, MissionPointsService, MyMissionsService] })
export class MissionsModule {}
