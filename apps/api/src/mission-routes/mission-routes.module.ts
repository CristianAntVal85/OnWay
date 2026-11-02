import { Module } from '@nestjs/common';
import { MissionRoutesReads } from './mission-routes-reads.service.js';
import { MissionRoutesWrites } from './mission-routes-writes.service.js';
import { MissionRoutesController } from './mission-routes.controller.js';
import { MyMissionRoutes } from './my-mission-routes.service.js';

/** The routes of a mission: the table, the pinned version, adding, changing and removing, the exports and the rescuer's reads (H4). The audit writer and the clock are global. */
@Module({ controllers: [MissionRoutesController], providers: [MissionRoutesReads, MissionRoutesWrites, MyMissionRoutes] })
export class MissionRoutesModule {}
