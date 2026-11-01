import { Controller, Inject, Req } from '@nestjs/common';
import type { AddMissionRoutesRequest, OperationOutput, UpdateMissionRouteRequest } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { MissionRoutesReads } from './mission-routes-reads.service.js';
import { MissionRoutesWrites } from './mission-routes-writes.service.js';

type MissionParams = { missionId: string };
type MissionRouteParams = { missionId: string; missionRouteId: string };

/** The routes inside a mission (H4). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class MissionRoutesController {
  constructor(
    @Inject(MissionRoutesReads) private readonly reads: MissionRoutesReads,
    @Inject(MissionRoutesWrites) private readonly writes: MissionRoutesWrites,
  ) {}

  @Operation('listMissionRoutes')
  list(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listMissionRoutes'>> {
    return this.reads.list(request.principal!, (input.params as MissionParams).missionId);
  }

  @Operation('getMissionRouteGeometry')
  geometry(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getMissionRouteGeometry'>> {
    const { missionId, missionRouteId } = input.params as MissionRouteParams;
    return this.reads.geometry(request.principal!, missionId, missionRouteId);
  }

  @Operation('addMissionRoutes')
  add(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'addMissionRoutes'>> {
    return this.writes.add(request.principal!, (input.params as MissionParams).missionId, input.body as z.infer<typeof AddMissionRoutesRequest>);
  }

  @Operation('updateMissionRoute')
  update(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'updateMissionRoute'>> {
    const { missionId, missionRouteId } = input.params as MissionRouteParams;
    return this.writes.update(request.principal!, missionId, missionRouteId, input.body as z.infer<typeof UpdateMissionRouteRequest>);
  }

  @Operation('removeMissionRoute')
  async remove(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<void> {
    const { missionId, missionRouteId } = input.params as MissionRouteParams;
    await this.writes.remove(request.principal!, missionId, missionRouteId);
  }
}
