import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { DbConnection } from './config.js';
import { schema } from './schema.js';

export const DB_CONNECTION = Symbol('DB_CONNECTION');

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type ContextRole = 'admin' | 'coordinator' | 'rescuer';

/** Who the transaction acts for: becomes `app.org_id`, `app.user_id` and `app.role` (doc 05 §6.1). */
export interface DbContext {
  orgId: string;
  userId: string;
  role: ContextRole;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly string[] = ['admin', 'coordinator', 'rescuer'];

/**
 * The only door to the database (D-H0-02). It opens a transaction per request, fixes the context with
 * `set_config(..., true)` and keeps the transaction in an AsyncLocalStorage; repositories read it with
 * `current()`. The pool is never exposed, so no business query can run outside a transaction.
 * The connection is always `onway_app`: row level security is the real defence (rule 1).
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: pg.Pool;
  private readonly db: Db;
  private readonly store = new AsyncLocalStorage<Tx>();

  constructor(@Inject(DB_CONNECTION) connection: DbConnection) {
    this.pool = new pg.Pool({ ...connection, max: 10, connectionTimeoutMillis: 5_000 });
    this.pool.on('error', (error) => this.logger.error(`idle client error: ${error.message}`));
    this.db = drizzle(this.pool, { schema });
  }

  /** Refuses to start with a role that would skip row level security. */
  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{ me: string; rolsuper: boolean; rolbypassrls: boolean; owned: string }>(
      `SELECT r.rolname AS me, r.rolsuper, r.rolbypassrls,
              (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS owned
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const role = rows[0];
    if (!role) throw new Error('cannot read the current database role');
    if (role.rolsuper || role.rolbypassrls || Number(role.owned) > 0) {
      throw new Error(`database role "${role.me}" skips row level security (superuser, BYPASSRLS or owner of tables); the API must connect as onway_app`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /** Runs `fn` in a transaction acting for `context`. Every business query goes through here. */
  async withContext<T>(context: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(context.orgId) || !UUID.test(context.userId) || !ROLES.includes(context.role)) {
      throw new Error('invalid database context');
    }
    return this.run(fn, async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.org_id', ${context.orgId}, true), set_config('app.user_id', ${context.userId}, true), set_config('app.role', ${context.role}, true)`,
      );
    });
  }

  /**
   * Transaction that knows only who is asking (`app.user_id`): for a user with no organization yet, i.e. an
   * account waiting for approval (INV-25). The organization and the role stay unset, so every organization
   * policy keeps its tables closed; only the user's own row is visible.
   */
  async withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(userId)) throw new Error('invalid database context');
    return this.run(fn, async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    });
  }

  /** The right transaction for an authenticated principal: full context, or only the user while pending. */
  async withPrincipal<T>(principal: { userId: string; orgId: string | null; role: ContextRole | 'pending' }, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (principal.orgId && principal.role !== 'pending') return this.withContext({ orgId: principal.orgId, userId: principal.userId, role: principal.role }, fn);
    return this.withUser(principal.userId, fn);
  }

  /**
   * Transaction with no context, for what happens before a session exists: SECURITY DEFINER functions
   * (`auth_*`), the `sessions` table (no RLS) and `SELECT 1`. Business tables return zero rows here.
   */
  async withAnonymous<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, async () => {});
  }

  /**
   * An anonymous transaction of its own, outside the one of the request: it commits even when the request then fails and rolls back.
   * Only for what must stay counted whatever happens next (a failed password check, D-P5); it must not touch rows the request has locked.
   */
  async independent<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.store.exit(() => this.withAnonymous(fn));
  }

  /** The transaction of the request being served. Throws outside `withContext`/`withAnonymous`. */
  current(): Tx {
    const tx = this.store.getStore();
    if (!tx) throw new Error('no database transaction in progress: use withContext() or withAnonymous()');
    return tx;
  }

  private async run<T>(fn: (tx: Tx) => Promise<T>, setup: (tx: Tx) => Promise<void>): Promise<T> {
    if (this.store.getStore()) throw new Error('a database transaction is already in progress');
    return this.db.transaction(async (tx) => {
      await setup(tx);
      return this.store.run(tx, () => fn(tx));
    });
  }
}
