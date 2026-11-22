import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { AddTeamMembersRequest, CreateTeamRequest, ListTeamsQuery, OperationOutput, UpdateTeamRequest } from '@onway/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { TeamsService } from './teams.service.js';

const teamId = (input: OperationInput) => (input.params as { teamId: string }).teamId;

/** Teams (H5-equipos, RF-801). Reading for the staff, writing for the coordinator and the administrator (registry roles, Q-12). Nothing personal is cached. */
@Controller()
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly teams: TeamsService) {}

  @Operation('listTeams')
  async listTeams(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'listTeams'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.teams.list(request.principal!, input.query as z.infer<typeof ListTeamsQuery>);
  }

  @Operation('createTeam')
  async createTeam(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createTeam'>> {
    return this.teams.create(request.principal!, input.body as z.infer<typeof CreateTeamRequest>);
  }

  @Operation('getTeam')
  async getTeam(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getTeam'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.teams.get(request.principal!, teamId(input));
  }

  @Operation('updateTeam')
  async updateTeam(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'updateTeam'>> {
    return this.teams.update(request.principal!, teamId(input), input.body as z.infer<typeof UpdateTeamRequest>);
  }

  @Operation('addTeamMembers')
  async addTeamMembers(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'addTeamMembers'>> {
    return this.teams.addMembers(request.principal!, teamId(input), input.body as z.infer<typeof AddTeamMembersRequest>);
  }

  @Operation('removeTeamMember')
  async removeTeamMember(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<void> {
    const params = input.params as { teamId: string; userId: string };
    return this.teams.removeMember(request.principal!, params.teamId, params.userId);
  }
}
