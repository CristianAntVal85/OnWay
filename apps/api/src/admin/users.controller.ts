import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { ListUsersQuery, OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { UsersService } from './users.service.js';

const userId = (input: OperationInput) => (input.params as { userId: string }).userId;

/**
 * Users of the organization (H5-usuarios, RF-813). Only the administrator: the registry lists `admin` alone and the global guard
 * refuses everyone else (rule 2). Contact data and email are personal data, so nothing is cached.
 */
@Controller()
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Operation('listUsers')
  async listUsers(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'listUsers'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.users.list(request.principal!, input.query as z.infer<typeof ListUsersQuery>);
  }

  @Operation('getUser')
  async getUser(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getUser'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.users.detail(request.principal!, userId(input));
  }
}
