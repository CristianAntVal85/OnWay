import { Inject, Injectable } from '@nestjs/common';
import type { OperationOutput } from '@onway/contracts';
import { eq, sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { pgErrorOf } from '../db/errors.js';
import { organizations, rescuerProfiles, users } from '../db/schema.js';
import { findAccount, standingOf, type Account } from './accounts.js';
import { dummyHash, hashPassword, verifyPassword } from './password.js';
import { sessionCookie } from './cookies.js';
import { SessionService } from './session.service.js';

/** Failed attempts before the account is locked, and for how long (doc 05 `auth_record_attempt`, RF-101). */
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

type SessionUser = OperationOutput<'getMe'>['user'];

function lockedError(lockedUntil: Date, now: Date): DomainError {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
  return new DomainError('ACCOUNT_LOCKED', 'Account temporarily locked', { retryAfterSeconds });
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * RF-101, D-H0-09. A wrong password and an unknown email answer the same `INVALID_CREDENTIALS`, and both pay
   * for one Argon2id verification (a throwaway hash when the email does not exist). The state of the account
   * (`ACCOUNT_REJECTED`, `ACCOUNT_DISABLED`) is only revealed after a correct password.
   */
  async login(email: string, password: string, userAgent: string | undefined): Promise<{ body: OperationOutput<'login'>; cookie: string }> {
    const account = await this.database.withAnonymous((tx) => findAccount(tx, email));

    if (account?.lockedUntil && account.lockedUntil.getTime() > this.clock.now().getTime()) {
      throw lockedError(account.lockedUntil, this.clock.now());
    }

    const correct = await verifyPassword(password, account?.passwordHash ?? (await dummyHash()));
    if (!account || !correct) {
      if (account) await this.recordFailure(account, email);
      throw new DomainError('INVALID_CREDENTIALS');
    }

    const { orgId, role } = standingOf(account);
    const issued = this.sessions.issue();
    const principal: Principal = { userId: account.id, orgId, role, accountStatus: account.accountStatus, sessionId: issued.sessionId, csrfToken: issued.csrfToken };
    const user = await this.database.withPrincipal(principal, (tx) => this.describe(tx, principal));

    await this.database.withAnonymous(async (tx) => {
      await tx.execute(sql`SELECT auth_record_attempt(${account.id}::uuid, true, ${MAX_FAILURES}, ${LOCK_MINUTES})`);
      await this.sessions.persist(tx, account.id, issued, userAgent);
    });
    return { body: { user, csrfToken: issued.csrfToken }, cookie: sessionCookie(issued.token, issued.maxAgeSeconds) };
  }

  /**
   * RF-104, RN-25. Creates a PENDING account and its signup request through `auth_register`; it never opens a session or grants a role.
   * An invalid code and an email that is already registered answer the same `REGISTRATION_FAILED`, and both pay for the Argon2id hash
   * first, so the time does not tell them apart (doc 06 §4.3). The password is hashed here and only the hash goes to the database.
   */
  async register(input: { email: string; password: string; displayName: string; inviteCode: string; locale: 'es' | 'fr' }): Promise<void> {
    const hash = await hashPassword(input.password);
    try {
      await this.database.withAnonymous((tx) => tx.execute(sql`SELECT auth_register(${input.email}::citext, ${hash}, ${input.displayName}, ${input.inviteCode}, ${input.locale})`));
    } catch (error) {
      // `invalid_parameter_value`: the function's own refusal (code or email). `unique_violation`: the same email registered at the same instant.
      const code = pgErrorOf(error)?.code;
      if (code === '22023' || code === '23505') throw new DomainError('REGISTRATION_FAILED');
      throw error;
    }
  }

  /** Counts the failure; the attempt that reaches the limit already answers 423, with the time left. */
  private async recordFailure(account: Account, email: string): Promise<void> {
    const lockedUntil = await this.database.withAnonymous(async (tx) => {
      await tx.execute(sql`SELECT auth_record_attempt(${account.id}::uuid, false, ${MAX_FAILURES}, ${LOCK_MINUTES})`);
      return (await findAccount(tx, email))?.lockedUntil ?? null;
    });
    const now = this.clock.now();
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) throw lockedError(lockedUntil, now);
  }

  /** The user of the session, as the contract declares it (`SessionUser`). Runs inside the principal's transaction. */
  async describe(tx: Tx, principal: Principal): Promise<SessionUser> {
    const [user] = await tx.select({ id: users.id, email: users.email, displayName: users.displayName, locale: users.locale }).from(users).where(eq(users.id, principal.userId)).limit(1);
    if (!user) throw new DomainError('UNAUTHENTICATED');

    const [organization] = principal.orgId ? await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, principal.orgId)).limit(1) : [];
    const [profile] = principal.role === 'rescuer' ? await tx.select({ status: rescuerProfiles.status }).from(rescuerProfiles).where(eq(rescuerProfiles.userId, principal.userId)).limit(1) : [];

    const profileStatus = principal.role === 'rescuer' ? (profile?.status ?? 'incomplete') : null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale === 'fr' ? 'fr' : 'es',
      accountStatus: principal.accountStatus,
      organization: organization ?? null,
      role: principal.role === 'pending' ? null : principal.role,
      profileStatus,
      nextStep: principal.role === 'pending' ? 'awaiting-approval' : profileStatus && profileStatus !== 'complete' ? 'complete-profile' : 'home',
    };
  }
}
