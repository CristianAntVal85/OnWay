import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { SkillsService, type SkillChanges, type SkillCreate } from './skills.service.js';

const skillId = (input: OperationInput) => (input.params as { skillId: string }).skillId;

/** `listMySkills`, `createMySkill`, `updateMySkill` and `deleteMySkill`: only the rescuer, only their own (the registry decides the role). */
@Controller()
export class SkillsController {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}

  @Operation('listMySkills')
  list(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'listMySkills'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.skills.list(request.principal!);
  }

  @Operation('createMySkill')
  create(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createMySkill'>> {
    return this.skills.create(request.principal!, input.body as SkillCreate);
  }

  @Operation('updateMySkill')
  update(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'updateMySkill'>> {
    return this.skills.update(request.principal!, skillId(input), input.body as SkillChanges);
  }

  @Operation('deleteMySkill')
  async remove(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<void> {
    await this.skills.remove(request.principal!, skillId(input));
  }
}
