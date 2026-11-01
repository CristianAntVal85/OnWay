import { Controller, Inject, Req } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { MissionRoutesReads } from './mission-routes-reads.service.js';

type MissionParams = { missionId: string };
type MissionRouteParams = { missionId: string; missionRouteId: string };

/** The routes inside a mission (H4). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class MissionRoutesController {
  constructor(@Inject(MissionRoutesReads) private readonly reads: MissionRoutesReads) {}

  @Operation('listMissionRoutes')
  list(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listMissionRoutes'>> {
    return this.reads.list(request.principal!, (input.params as MissionParams).missionId);
  }

  @Operation('getMissionRouteGeometry')
  geometry(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getMissionRouteGeometry'>> {
    const { missionId, missionRouteId } = input.params as MissionRouteParams;
    return this.reads.geometry(request.principal!, missionId, missionRouteId);
  }
}
