import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { DecideSignupRequest, ListSignupRequestsQuery, OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { InviteCode } from './invite-code.service.js';
import { SignupRequests } from './signup-requests.service.js';

/**
 * Administration of the organization (H5-acceso): sign-up requests and the invitation code. Only the administrator: the registry lists
 * `admin` alone and the global guard refuses everyone else (rule 2). Everything here is personal data or a secret, so nothing is cached.
 */
@Controller()
export class AdminController {
  constructor(
    @Inject(SignupRequests) private readonly signups: SignupRequests,
    @Inject(InviteCode) private readonly inviteCode: InviteCode,
  ) {}

  @Operation('listSignupRequests')
  async listSignupRequests(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'listSignupRequests'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.signups.list(request.principal!, input.query as z.infer<typeof ListSignupRequestsQuery>);
  }

  @Operation('decideSignupRequests')
  async decideSignupRequests(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'decideSignupRequests'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.signups.decide(request.principal!, input.body as z.infer<typeof DecideSignupRequest>);
  }

  @Operation('getInviteCode')
  async getInviteCode(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getInviteCode'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.inviteCode.get(request.principal!);
  }

  @Operation('rotateInviteCode')
  async rotateInviteCode(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'rotateInviteCode'>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.inviteCode.rotate(request.principal!);
  }
}
