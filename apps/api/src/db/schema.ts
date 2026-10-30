// Drizzle schema of the tables H0 reads. The SQL migrations (db/migrations) are the source of truth;
// test/api/schema.test.ts compares this file with information_schema so they cannot drift apart.
import { boolean, char, customType, integer, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const accountStatus = pgEnum('account_status', ['pending', 'active', 'rejected', 'disabled']);
export const memberRole = pgEnum('member_role', ['coordinator', 'rescuer', 'admin']);
export const memberStatus = pgEnum('member_status', ['active', 'disabled']);
export const profileStatus = pgEnum('profile_status', ['incomplete', 'complete', 'deleted']);
export const teamStatus = pgEnum('team_status', ['active', 'archived']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  country: char('country', { length: 2 }).notNull(),
  status: text('status').notNull().default('active'),
  inviteCode: text('invite_code').notNull().unique(),
  inviteRotatedAt: timestamptz('invite_rotated_at').notNull().defaultNow(),
  validationMaxAgeDays: integer('validation_max_age_days').notNull().default(90),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('es'),
  accountStatus: accountStatus('account_status').notNull().default('pending'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  failedLogins: smallint('failed_logins').notNull().default(0),
  lockedUntil: timestamptz('locked_until'),
  lastLoginAt: timestamptz('last_login_at'),
  anonymizedAt: timestamptz('anonymized_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: bytea('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
  userAgent: text('user_agent'),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull().unique(),
    role: memberRole('role').notNull(),
    status: memberStatus('status').notNull().default('active'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.organizationId, t.userId)],
);

export const rescuerProfiles = pgTable('rescuer_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  userId: uuid('user_id').notNull().unique(),
  fullName: text('full_name').notNull(),
  status: profileStatus('status').notNull().default('incomplete'),
  completedAt: timestamptz('completed_at'),
  deletedAt: timestamptz('deleted_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  locality: text('locality').notNull(),
  status: teamStatus('status').notNull().default('active'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    addedAt: timestamptz('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const enums = { accountStatus, memberRole, memberStatus, profileStatus, teamStatus };

export const schema = { organizations, users, sessions, memberships, rescuerProfiles, teams, teamMembers };
