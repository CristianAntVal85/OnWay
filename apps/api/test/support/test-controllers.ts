// Test-only controllers on SYNTHETIC endpoints: they are not in the registry or the OpenAPI, and the real
// application never loads them. They exist because H0 has no staff-only operation (RF-103) and because the
// guard, the transaction context and the response check need handlers to run against.
import { Controller, Inject, Req } from '@nestjs/common';
import type { Endpoint } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { mountEndpoint, type OnwayRequest } from '../../src/common/operation.js';
import { DatabaseService } from '../../src/db/database.service.js';

const base = { tag: 'Test', summary: 'test only', milestone: 'H0', delivery: 1 } as const;

/** Restricted to staff, like the registry's staff operations (`STAFF` roles). */
export const STAFF_ONLY: Endpoint = {
  ...base,
  id: 'testStaffOnly',
  method: 'GET',
  path: '/test-only/staff',
  roles: ['coordinator', 'admin'],
  response: { status: 200, schema: z.strictObject({ ok: z.literal(true) }) },
};

/** Reports the transaction context the handler runs in. Reachable by every session role, pending included. */
export const CONTEXT_PROBE: Endpoint = {
  ...base,
  id: 'testContext',
  method: 'GET',
  path: '/test-only/context',
  roles: ['pending', 'rescuer', 'coordinator', 'admin'],
  response: {
    status: 200,
    schema: z.strictObject({ orgId: z.string().nullable(), userId: z.string().nullable(), role: z.string().nullable(), visibleMemberships: z.number(), visibleUsers: z.number() }),
  },
};

/** Answers with a field its contract does not declare: the server must refuse to send it (AC-16). */
export const BAD_RESPONSE: Endpoint = {
  ...base,
  id: 'testBadResponse',
  method: 'GET',
  path: '/test-only/bad-response',
  roles: ['rescuer', 'coordinator', 'admin'],
  response: { status: 200, schema: z.strictObject({ ok: z.literal(true) }) },
};

/** A write that lists no `pending`: for the pending-account and CSRF checks on non-GET methods. */
export const WRITE_PROBE: Endpoint = {
  ...base,
  id: 'testWrite',
  method: 'POST',
  path: '/test-only/write',
  roles: ['rescuer', 'coordinator', 'admin'],
  response: { status: 200, schema: z.strictObject({ ok: z.literal(true) }) },
};

@Controller()
export class TestOnlyController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @mountEndpoint(STAFF_ONLY)
  staffOnly() {
    return { ok: true };
  }

  @mountEndpoint(CONTEXT_PROBE)
  async context(@Req() _request: OnwayRequest) {
    const result = await this.database.current().execute<{ org: string | null; usr: string | null; role: string | null; memberships: string; users: string }>(
      sql`SELECT nullif(current_setting('app.org_id', true), '') AS org, nullif(current_setting('app.user_id', true), '') AS usr, nullif(current_setting('app.role', true), '') AS role,
                   (SELECT count(*) FROM memberships) AS memberships, (SELECT count(*) FROM users) AS users`,
    );
    const row = result.rows[0]!;
    return { orgId: row.org, userId: row.usr, role: row.role, visibleMemberships: Number(row.memberships), visibleUsers: Number(row.users) };
  }

  @mountEndpoint(BAD_RESPONSE)
  badResponse() {
    return { ok: true, extra: 'not in the contract' };
  }

  @mountEndpoint(WRITE_PROBE)
  write() {
    return { ok: true };
  }
}
