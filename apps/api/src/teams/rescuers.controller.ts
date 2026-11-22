import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { ListRescuersQuery, OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { RescuersService } from './rescuers.service.js';

/** The picker of rescuers for the members of a team (H5-equipos, RF-801). Staff only (registry roles); nothing personal is cached. */
@Controller()
export class RescuersController {
  constructor(@Inject(RescuersService) private readonly rescuers: RescuersService) {}

  @Operation('listRescuers')
  async listRescuers(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'listRescuers'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.rescuers.list(request.principal!, input.query as z.infer<typeof ListRescuersQuery>);
  }
}
