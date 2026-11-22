import { Module } from '@nestjs/common';
import { RescuersController } from './rescuers.controller.js';
import { RescuersService } from './rescuers.service.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

/** The teams of the organization and the picker of rescuers (RF-801). The audit writer and the database are global. */
@Module({ controllers: [TeamsController, RescuersController], providers: [TeamsService, RescuersService] })
export class TeamsModule {}
