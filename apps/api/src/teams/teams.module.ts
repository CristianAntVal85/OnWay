import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

/** The teams of the organization (RF-801). The audit writer and the database are global. */
@Module({ controllers: [TeamsController], providers: [TeamsService] })
export class TeamsModule {}
