import { Module } from '@nestjs/common';
import { MissionRoutesReads } from './mission-routes-reads.service.js';
import { MissionRoutesWrites } from './mission-routes-writes.service.js';
import { MissionRoutesController } from './mission-routes.controller.js';

/** The routes of a mission: the table, the pinned version, adding, changing and removing (H4). The audit writer and the clock are global. */
@Module({ controllers: [MissionRoutesController], providers: [MissionRoutesReads, MissionRoutesWrites] })
export class MissionRoutesModule {}
