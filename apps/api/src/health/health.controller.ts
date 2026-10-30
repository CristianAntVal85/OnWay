import { Controller, Inject } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { Operation } from '../common/operation.js';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Operation('getHealth')
  getHealth(): Promise<OperationOutput<'getHealth'>> {
    return this.health.check();
  }
}
