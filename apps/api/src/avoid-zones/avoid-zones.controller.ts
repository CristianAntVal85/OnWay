import { Controller, Inject, Req } from '@nestjs/common';
import type { CreateAvoidZoneRequest, ListAvoidZonesQuery, OperationOutput } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { AvoidZones } from './avoid-zones.service.js';

/** Zones to avoid (H3). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class AvoidZonesController {
  constructor(@Inject(AvoidZones) private readonly zones: AvoidZones) {}

  @Operation('listAvoidZones')
  list(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'listAvoidZones'>> {
    return this.zones.list(request.principal!, input.query as z.infer<typeof ListAvoidZonesQuery>);
  }

  @Operation('createAvoidZone')
  create(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'createAvoidZone'>> {
    return this.zones.create(request.principal!, input.body as z.infer<typeof CreateAvoidZoneRequest>);
  }

  @Operation('deleteAvoidZone')
  async remove(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<void> {
    await this.zones.remove(request.principal!, (input.params as { zoneId: string }).zoneId);
  }
}
