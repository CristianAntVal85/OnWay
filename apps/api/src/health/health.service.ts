import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';

/**
 * D-H0-12: in H0 only the database is checked. `routingEngine` and `weatherProvider` stay `false` until
 * their adapters exist and do not degrade `status` before that (doc 06, note of `getHealth`).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<OperationOutput<'getHealth'>> {
    let databaseUp = false;
    try {
      await this.database.withAnonymous((tx) => tx.execute(sql`SELECT 1`));
      databaseUp = true;
    } catch (error) {
      this.logger.warn(`database check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { status: databaseUp ? 'ok' : 'degraded', checks: { database: databaseUp, routingEngine: false, weatherProvider: false } };
  }
}
