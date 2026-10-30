import { Controller, Inject, Req } from '@nestjs/common';
import type { ElevationQuery, GeocodeQuery, OperationOutput } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { GeoService } from './geo.service.js';

/** Staff-only map helpers. Role, session and CSRF come from the registry through the global guard: a rescuer gets 403. */
@Controller()
export class GeoController {
  constructor(@Inject(GeoService) private readonly geo: GeoService) {}

  @Operation('geocode')
  geocode(@Input() input: OperationInput): Promise<OperationOutput<'geocode'>> {
    return this.geo.geocode(input.query as z.infer<typeof GeocodeQuery>);
  }

  @Operation('getElevation')
  elevation(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getElevation'>> {
    return this.geo.elevationAt(request.principal!, input.query as z.infer<typeof ElevationQuery>);
  }
}
