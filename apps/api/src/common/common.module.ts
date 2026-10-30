import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessGuard } from './access.guard.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { OperationInterceptor } from './operation.interceptor.js';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: OperationInterceptor },
  ],
})
export class CommonModule {}
