import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { CLOCK, type Clock } from '../clock/clock.js';
import { DomainError } from '../common/domain-error.js';
import type { Authenticator } from '../common/authenticator.js';
import type { Principal } from '../common/operation.js';
import { DatabaseService, type Tx } from '../db/database.service.js';
import { sessions, users } from '../db/schema.js';
import { findAccount, standingOf } from './accounts.js';
import { IDENTITY_OPTIONS, type IdentityOptions } from './config.js';
import { readCookie, SESSION_COOKIE } from './cookies.js';
import { csrfTokenFor } from '../common/csrf.js';

const TOKEN_BYTES = 32; // 256 bits (D-H0-07)
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const USER_AGENT_MAX = 200;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** A session that exists only in memory until `persist` stores its hash. */
export interface IssuedSession {
  token: string;
  sessionId: Buffer;
  csrfToken: string;
  expiresAt: Date;
  maxAgeSeconds: number;
}

/** Sessions kept in the database so they can be revoked (doc 04 §10); the token is only ever stored as a hash. */
@Injectable()
export class SessionService implements Authenticator {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}

  issue(): IssuedSession {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return {
      token,
      sessionId: sha256(token),
      csrfToken: csrfTokenFor(this.options.csrfSecret, token),
      expiresAt: new Date(this.clock.now().getTime() + this.options.sessionTtlMs),
      maxAgeSeconds: Math.floor(this.options.sessionTtlMs / 1000),
    };
  }

  async persist(tx: Tx, userId: string, issued: IssuedSession, userAgent: string | undefined): Promise<void> {
    const now = this.clock.now();
    await tx.insert(sessions).values({
      id: issued.sessionId,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: issued.expiresAt,
      userAgent: userAgent?.slice(0, USER_AGENT_MAX) ?? null,
    });
  }

  /** Closes this session only. Runs inside the request's transaction. */
  async revoke(tx: Tx, sessionId: Buffer): Promise<void> {
    await tx.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /**
   * Resolves the cookie to a principal on EVERY request (D-H0-03), so a deactivated account loses access at once:
   * session row → expiry → the user's current account state and membership.
   */
  async authenticate(request: Request): Promise<Principal> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token || !TOKEN_SHAPE.test(token)) throw new DomainError('UNAUTHENTICATED');
    const sessionId = sha256(token);

    const [session] = await this.database.withAnonymous((tx) => tx.select({ userId: sessions.userId, expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, sessionId)).limit(1));
    if (!session) throw new DomainError('UNAUTHENTICATED');
    if (session.expiresAt.getTime() <= this.clock.now().getTime()) throw new DomainError('SESSION_EXPIRED');

    const account = await this.database.withUser(session.userId, async (tx) => {
      const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, session.userId)).limit(1);
      return me ? findAccount(tx, me.email) : undefined;
    });
    if (!account) throw new DomainError('UNAUTHENTICATED');

    const { orgId, role } = standingOf(account);
    return { userId: account.id, orgId, role, accountStatus: account.accountStatus, sessionId, csrfToken: csrfTokenFor(this.options.csrfSecret, token) };
  }
}
