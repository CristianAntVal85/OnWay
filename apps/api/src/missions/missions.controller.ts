import { Controller, Inject, Req } from '@nestjs/common';
import type { CreateMissionRequest, ListMissionsQuery, OperationOutput, PageQuery, UpdateMissionRequest } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { MissionsService } from './missions.service.js';

type MissionParams = { missionId: string };

/** Staff operations on missions (H1-T2). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class MissionsController {
  constructor(@Inject(MissionsService) private readonly missions: MissionsService) {}

  @Operation('listMissions')
  list(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listMissions'>> {
    return this.missions.list(request.principal!, input.query as z.infer<typeof ListMissionsQuery>);
  }

  @Operation('createMission')
  create(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createMission'>> {
    return this.missions.create(request.principal!, input.body as z.infer<typeof CreateMissionRequest>);
  }

  @Operation('getMission')
  get(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getMission'>> {
    return this.missions.get(request.principal!, (input.params as MissionParams).missionId);
  }

  @Operation('updateMission')
  update(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'updateMission'>> {
    return this.missions.update(request.principal!, (input.params as MissionParams).missionId, input.body as z.infer<typeof UpdateMissionRequest>);
  }

  @Operation('listMissionHistory')
  history(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listMissionHistory'>> {
    return this.missions.history(request.principal!, (input.params as MissionParams).missionId, input.query as z.infer<typeof PageQuery>);
  }
}
