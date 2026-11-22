import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { DatabaseService } from '../db/database.service.js';
import { ProfileService, type ProfileChanges } from './profile.service.js';

const noStore = (response: Response) => response.setHeader('Cache-Control', 'no-store');

@Controller()
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Operation('getMyProfile')
  async getMyProfile(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getMyProfile'>> {
    noStore(response);
    return this.profiles.describe(this.database.current(), request.principal!);
  }

  @Operation('updateMyProfile')
  async updateMyProfile(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'updateMyProfile'>> {
    noStore(response);
    return this.profiles.update(this.database.current(), request.principal!, input.body as ProfileChanges);
  }

  @Operation('getMySensitive')
  async getMySensitive(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getMySensitive'>> {
    // Never kept by a browser or a proxy (doc 06): the unmasked document and address leave only on request.
    noStore(response);
    return this.profiles.sensitive(this.database.current(), request.principal!);
  }
}
