import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { sql } from 'drizzle-orm';
import { AuditWriter } from '../audit/audit.writer.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { pgErrorOf } from '../db/errors.js';
import { isoUtc, viewerOf } from '../missions/mission-support.js';

/** Letters and digits without the ones that look alike (I, O, 0, 1): 32 symbols, so every symbol carries exactly 5 bits. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_SIZE = 4;

/** 16 symbols = 80 bits, from the system's secure generator (`randomInt` has no modulo bias), in groups of 4 to read it aloud: `K7QM-X2PD-9WTR-HC4N`. */
export function newInviteCode(): string {
  const group = () => Array.from({ length: GROUP_SIZE }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return Array.from({ length: GROUPS }, group).join('-');
}

/**
 * The invitation code of the organization (RF-104, D-25): only its administrator sees it (D-A6) and rotating it invalidates the old
 * one at once, because `auth_register` compares against the single `invite_code` column (D-A5). The update goes through the policy
 * `org_update` with the transaction of the request: no superuser, no `BYPASSRLS`. The code is never written to the audit log.
 */
@Injectable()
export class InviteCode {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  private get tx(): Tx {
    return this.database.current();
  }

  async get(principal: Principal): Promise<OperationOutput<'getInviteCode'>> {
    const { orgId } = viewerOf(principal);
    const { rows } = await this.tx.execute(sql`SELECT invite_code, ${sql.raw(isoUtc('invite_rotated_at'))} AS rotated_at FROM organizations WHERE id = ${orgId}::uuid`);
    const row = (rows as unknown as { invite_code: string; rotated_at: string }[])[0];
    if (!row) throw new DomainError('NOT_FOUND');
    return { code: row.invite_code, rotatedAt: row.rotated_at };
  }

  async rotate(principal: Principal): Promise<OperationOutput<'rotateInviteCode'>> {
    const { orgId, userId } = viewerOf(principal);
    // A collision with another organization's code (a unique column) has odds of 2^-80; one retry is enough and a second one is a bug.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newInviteCode();
      try {
        // A savepoint keeps the request's transaction usable if the unique index rejects the code and a new one is tried.
        const rows = await this.tx.transaction(async (savepoint) => {
          const { rows: updated } = await savepoint.execute(
            sql`UPDATE organizations SET invite_code = ${code}, invite_rotated_at = now() WHERE id = ${orgId}::uuid RETURNING invite_code, ${sql.raw(isoUtc('invite_rotated_at'))} AS rotated_at`,
          );
          return updated as unknown as { invite_code: string; rotated_at: string }[];
        });
        const row = rows[0];
        // org_update lets only an administrator through; zero rows means the policy (or the organization) said no.
        if (!row) throw new DomainError('NOT_FOUND');
        await this.audit.recordInviteCodeRotated({ orgId, actorUserId: userId });
        return { code: row.invite_code, rotatedAt: row.rotated_at };
      } catch (error) {
        if (pgErrorOf(error)?.code === '23505') continue;
        throw error;
      }
    }
    throw new DomainError('INTERNAL', 'could not generate a unique invitation code');
  }
}
