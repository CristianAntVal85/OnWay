// Test-only controllers: they mount operations H0 already allows so the guard, the validation pipe and the
// transaction context can be exercised before the real login and getMe exist (T5).
import { Controller, Inject } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { Input, Operation, type OperationInput } from '../../src/common/operation.js';
import { DatabaseService } from '../../src/db/database.service.js';

export interface Seen {
  orgId: string | null;
  userId: string | null;
  role: string | null;
  visibleMemberships: number;
}

export const probe = { seen: [] as Seen[], badResponse: false, bodies: [] as unknown[] };

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'stub@example.org',
  displayName: 'Stub',
  locale: 'es',
  accountStatus: 'active',
  organization: null,
  role: null,
  profileStatus: null,
  nextStep: 'home',
} as const;

@Controller()
export class StubController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Operation('getMe')
  async me(): Promise<OperationOutput<'getMe'>> {
    const result = await this.database
      .current()
      .execute<{ org: string | null; usr: string | null; role: string | null; visible: string }>(
        sql`SELECT current_setting('app.org_id', true) AS org, current_setting('app.user_id', true) AS usr, current_setting('app.role', true) AS role, (SELECT count(*) FROM memberships) AS visible`,
      );
    const row = result.rows[0]!;
    probe.seen.push({ orgId: row.org, userId: row.usr, role: row.role, visibleMemberships: Number(row.visible) });
    if (probe.badResponse) return { user, csrfToken: 'x', extra: 'not in the contract' } as unknown as OperationOutput<'getMe'>;
    return { user, csrfToken: 'stub' };
  }

  @Operation('login')
  login(@Input() input: OperationInput): OperationOutput<'login'> {
    probe.bodies.push(input.body);
    return { user, csrfToken: 'stub' };
  }
}
