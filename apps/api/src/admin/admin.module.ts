import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { InviteCode } from './invite-code.service.js';
import { SignupRequests } from './signup-requests.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/** Sign-up requests, the invitation code (RF-106) and the users of the organization (RF-813). The audit writer and the database are global. */
@Module({ controllers: [AdminController, UsersController], providers: [SignupRequests, InviteCode, UsersService] })
export class AdminModule {}
