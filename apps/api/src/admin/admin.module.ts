import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { InviteCode } from './invite-code.service.js';
import { SignupRequests } from './signup-requests.service.js';

/** Sign-up requests and the invitation code (RF-106). The audit writer and the database are global. */
@Module({ controllers: [AdminController], providers: [SignupRequests, InviteCode] })
export class AdminModule {}
