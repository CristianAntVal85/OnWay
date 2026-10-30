import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import { Operation, type OnwayRequest } from '../common/operation.js';
import { DatabaseService } from '../db/database.service.js';
import { OrganizationService } from './organization.service.js';

@Controller()
export class OrganizationController {
  constructor(
    @Inject(OrganizationService) private readonly organizations: OrganizationService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Operation('getOrganization')
  async getOrganization(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getOrganization'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.organizations.describe(this.database.current(), request.principal!);
  }

  @Operation('listCoordinators')
  async listCoordinators(@Req() request: OnwayRequest): Promise<OperationOutput<'listCoordinators'>> {
    return this.organizations.listCoordinators(this.database.current(), request.principal!);
  }
}
