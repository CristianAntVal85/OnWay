import { Controller, Inject, Req } from '@nestjs/common';
import type {
  ActivateMissionRequest,
  CloseMissionRequest,
  DuplicateMissionRequest,
  CreateMissionRequest,
  ListMissionsQuery,
  ListMyMissionsQuery,
  OperationOutput,
  PageQuery,
  PointInput,
  UpdateMissionRequest,
  UpdatePointRequest,
} from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { MissionLifecycleService } from './mission-lifecycle.service.js';
import { MissionPointsService } from './mission-points.service.js';
import { MissionsService } from './missions.service.js';
import { MyMissionsService } from './my-missions.service.js';

type MissionParams = { missionId: string };
type PointParams = { missionId: string; pointId: string };

/** Staff operations on missions: create, read, edit, list, history (H1-T2), life cycle and points (H1-T3). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class MissionsController {
  constructor(
    @Inject(MissionsService) private readonly missions: MissionsService,
    @Inject(MissionLifecycleService) private readonly lifecycle: MissionLifecycleService,
    @Inject(MissionPointsService) private readonly points: MissionPointsService,
  ) {}

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

  @Operation('activateMission')
  activate(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'activateMission'>> {
    return this.lifecycle.activate(request.principal!, (input.params as MissionParams).missionId, input.body as z.infer<typeof ActivateMissionRequest>);
  }

  @Operation('closeMission')
  close(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'closeMission'>> {
    return this.lifecycle.close(request.principal!, (input.params as MissionParams).missionId, input.body as z.infer<typeof CloseMissionRequest>);
  }

  @Operation('reopenMission')
  reopen(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'reopenMission'>> {
    return this.lifecycle.reopen(request.principal!, (input.params as MissionParams).missionId);
  }

  @Operation('duplicateMission')
  duplicate(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'duplicateMission'>> {
    return this.lifecycle.duplicate(request.principal!, (input.params as MissionParams).missionId, input.body as z.infer<typeof DuplicateMissionRequest>);
  }

  @Operation('createMissionPoint')
  createPoint(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createMissionPoint'>> {
    return this.points.create(request.principal!, (input.params as MissionParams).missionId, input.body as z.infer<typeof PointInput>);
  }

  @Operation('updateMissionPoint')
  updatePoint(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'updateMissionPoint'>> {
    const { missionId, pointId } = input.params as PointParams;
    return this.points.update(request.principal!, missionId, pointId, input.body as z.infer<typeof UpdatePointRequest>);
  }

  @Operation('deleteMissionPoint')
  async deletePoint(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<void> {
    const { missionId, pointId } = input.params as PointParams;
    await this.points.remove(request.principal!, missionId, pointId);
  }
}

/** The rescuer's read-only views of missions (RF-601, RF-602). They are separate on purpose: other response types, other role (doc 06 §6). */
@Controller()
export class MyMissionsController {
  constructor(@Inject(MyMissionsService) private readonly missions: MyMissionsService) {}

  @Operation('listMyMissions')
  list(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listMyMissions'>> {
    return this.missions.list(request.principal!, input.query as z.infer<typeof ListMyMissionsQuery>);
  }

  @Operation('getMyMission')
  get(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getMyMission'>> {
    return this.missions.get(request.principal!, (input.params as MissionParams).missionId);
  }
}
