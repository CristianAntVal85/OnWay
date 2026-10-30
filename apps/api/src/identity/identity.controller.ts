import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import { Input, Operation, type OnwayRequest, type OperationInput } from '../common/operation.js';
import { DatabaseService } from '../db/database.service.js';
import { AuthService } from './auth.service.js';
import { clearedSessionCookie } from './cookies.js';
import { SessionService } from './session.service.js';

const noStore = (response: Response) => response.setHeader('Cache-Control', 'no-store');

@Controller()
export class IdentityController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Operation('login')
  async login(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'login'>> {
    const { email, password } = input.body as { email: string; password: string };
    const { body, cookie } = await this.auth.login(email, password, request.header('user-agent'));
    response.setHeader('Set-Cookie', cookie);
    noStore(response);
    return body;
  }

  @Operation('logout')
  async logout(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.revoke(this.database.current(), request.principal!.sessionId);
    response.setHeader('Set-Cookie', clearedSessionCookie());
    noStore(response);
  }

  @Operation('getMe')
  async getMe(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getMe'>> {
    const principal = request.principal!;
    noStore(response);
    return { user: await this.auth.describe(this.database.current(), principal), csrfToken: principal.csrfToken };
  }
}
