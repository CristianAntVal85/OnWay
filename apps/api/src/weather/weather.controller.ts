import { Controller, Inject, Req } from '@nestjs/common';
import type { EnvironmentQuery, OperationOutput } from '@onway/contracts';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { WeatherService } from './weather.service.js';

/** `getEnvironment` for every role with a session: role, session and CSRF come from the registry through the global guard. */
@Controller()
export class WeatherController {
  constructor(@Inject(WeatherService) private readonly weather: WeatherService) {}

  @Operation('getEnvironment')
  environment(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getEnvironment'>> {
    return this.weather.environment(request.principal!, input.query as z.infer<typeof EnvironmentQuery>);
  }
}
