import { Controller, Inject, Req, Res, type StreamableFile } from '@nestjs/common';
import type { AddMissionRoutesRequest, ExportMissionRoutesQuery, OperationOutput, UpdateMissionRouteRequest } from '@onway/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { download } from '../common/download.js';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { MissionRoutesReads } from './mission-routes-reads.service.js';
import { MissionRoutesWrites } from './mission-routes-writes.service.js';
import { MyMissionRoutes } from './my-mission-routes.service.js';

type MissionParams = { missionId: string };
type MissionRouteParams = { missionId: string; missionRouteId: string };

/** The routes inside a mission (H4). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class MissionRoutesController {
  constructor(
    @Inject(MissionRoutesReads) private readonly reads: MissionRoutesReads,
    @Inject(MissionRoutesWrites) private readonly writes: MissionRoutesWrites,
    @Inject(MyMissionRoutes) private readonly mine: MyMissionRoutes,
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

  @Operation('exportMissionRoutes')
  async exportMission(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    return download(response, await this.reads.export(request.principal!, (input.params as MissionParams).missionId, input.query as z.infer<typeof ExportMissionRoutesQuery>));
  }

  // The rescuer's side (RF-601 to RF-603): read-only, and only the validated, pinned versions (INV-05).
  @Operation('listMyMissionRoutes')
  listMine(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listMyMissionRoutes'>> {
    return this.mine.list(request.principal!, (input.params as MissionParams).missionId);
  }

  @Operation('getMyMissionRouteGeometry')
  geometryMine(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getMyMissionRouteGeometry'>> {
    const { missionId, missionRouteId } = input.params as MissionRouteParams;
    return this.mine.geometry(request.principal!, missionId, missionRouteId);
  }

  @Operation('exportMyMissionRoutes')
  async exportMine(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    return download(response, await this.mine.export(request.principal!, (input.params as MissionParams).missionId, input.query as z.infer<typeof ExportMissionRoutesQuery>));
  }
}
