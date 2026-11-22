import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import type { Response } from 'express';
import { clientKey } from '../common/client-ip.js';
import { PUBLIC_RATE_LIMITER, type PublicRateLimiter } from '../common/public-rate-limiter.js';
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
    @Inject(PUBLIC_RATE_LIMITER) private readonly limiter: PublicRateLimiter,
  ) {}

  @Operation('register')
  async register(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'register'>> {
    // Before the hash: a flood must not make the server spend its time on Argon2id.
    this.limiter.assert('register', clientKey(request));
    const { email, password, displayName, inviteCode, locale } = input.body as { email: string; password: string; displayName: string; inviteCode: string; locale: 'es' | 'fr' };
    await this.auth.register({ email, password, displayName, inviteCode, locale });
    noStore(response);
    return { status: 'received' };
  }

  @Operation('forgotPassword')
  async forgotPassword(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'forgotPassword'>> {
    // Before anything else: a refused request must not reach the database or send a mail.
    this.limiter.assert('forgotPassword', clientKey(request));
    await this.auth.requestPasswordReset((input.body as { email: string }).email);
    noStore(response);
    return { ok: true };
  }

  @Operation('resetPassword')
  async resetPassword(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    // Before the hash, like `register`: a flood must not make the server spend its time on Argon2id.
    this.limiter.assert('resetPassword', clientKey(request));
    const { token, newPassword } = input.body as { token: string; newPassword: string };
    await this.auth.resetPassword(token, newPassword);
    noStore(response);
  }

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

  @Operation('updateMe')
  async updateMe(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'updateMe'>> {
    const principal = request.principal!;
    noStore(response);
    const user = await this.auth.updateMe(this.database.current(), principal, input.body as { displayName?: string; locale?: 'es' | 'fr' });
    return { user, csrfToken: principal.csrfToken };
  }

  @Operation('changePassword')
  async changePassword(@Input() input: OperationInput, @Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    const { currentPassword, newPassword } = input.body as { currentPassword: string; newPassword: string };
    await this.auth.changePassword(this.database.current(), request.principal!, currentPassword, newPassword);
    noStore(response);
  }

  @Operation('getMe')
  async getMe(@Req() request: OnwayRequest, @Res({ passthrough: true }) response: Response): Promise<OperationOutput<'getMe'>> {
    const principal = request.principal!;
    noStore(response);
    return { user: await this.auth.describe(this.database.current(), principal), csrfToken: principal.csrfToken };
  }
}
