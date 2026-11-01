import { Module } from '@nestjs/common';
import { MissionRoutesReads } from './mission-routes-reads.service.js';
import { MissionRoutesController } from './mission-routes.controller.js';

/** The routes of a mission: the table, the pinned version and, from H4-T2, adding, changing and removing. The audit writer and the clock are global. */
@Module({ controllers: [MissionRoutesController], providers: [MissionRoutesReads] })
export class MissionRoutesModule {}
