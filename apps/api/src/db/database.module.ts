import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { DbConnection } from './config.js';
import { DB_CONNECTION, DatabaseService } from './database.service.js';

@Global()
@Module({})
export class DatabaseModule {
  static register(connection: DbConnection): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: DB_CONNECTION, useValue: connection }, DatabaseService],
      exports: [DatabaseService],
    };
  }
}
