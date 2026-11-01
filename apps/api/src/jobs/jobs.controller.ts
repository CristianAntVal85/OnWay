import { Controller, Inject, Req } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { CalculationJobs } from './calculation-jobs.service.js';

/** The progress and the result of a calculation (H3). Role, session and CSRF are decided by the global guard from the registry. */
@Controller()
export class JobsController {
  constructor(@Inject(CalculationJobs) private readonly jobs: CalculationJobs) {}

  @Operation('getJob')
  get(@Input() input: OperationInput, @Req() request: OnwayRequest): Promise<OperationOutput<'getJob'>> {
    return this.jobs.get(request.principal!, (input.params as { jobId: string }).jobId);
  }
}
