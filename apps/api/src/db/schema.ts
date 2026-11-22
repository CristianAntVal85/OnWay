// Drizzle schema of the tables the API reads and writes (H0, plus the mission tables from H1 and `files` from H2). The SQL migrations (db/migrations) are the source of truth;
// test/api/schema.test.ts compares this file with information_schema so they cannot drift apart.
import { bigint, boolean, char, customType, date, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
/**
 * `geometry(PointZ, 4326)`. Its value is never read or written through Drizzle: the queries build it with
 * `ST_MakePoint` and read it back with `ST_X/ST_Y/ST_Z` in their own SQL, so a column here only gives the name and the type.
 */
const pointZ = customType<{ data: string }>({ dataType: () => 'geometry(PointZ,4326)' });

export const accountStatus = pgEnum('account_status', ['pending', 'active', 'rejected', 'disabled']);
export const memberRole = pgEnum('member_role', ['coordinator', 'rescuer', 'admin']);
export const memberStatus = pgEnum('member_status', ['active', 'disabled']);
export const profileStatus = pgEnum('profile_status', ['incomplete', 'complete', 'deleted']);
export const teamStatus = pgEnum('team_status', ['active', 'archived']);
export const missionStatus = pgEnum('mission_status', ['planning', 'active', 'closed']);
export const pointKind = pgEnum('point_kind', ['origin', 'waypoint', 'rendezvous']);
export const targetSource = pgEnum('target_source', ['coordinates', 'map', 'address']);
export const filePurpose = pgEnum('file_purpose', ['certificate', 'route_import']);

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
    /** Q-36: lo fija solo `set_member_alias` (la aplicación no puede escribirlo). */
    alias: text('alias'),
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

// The two other entities of the rescuer profile (INV-32): each table has its own policy, so they are read one by one, never joined.
export const documentType = pgEnum('document_type', ['dni', 'nie', 'passport', 'other']);
export const skillKind = pgEnum('skill_kind', ['course', 'skill']);

export const rescuerContact = pgTable('rescuer_contact', {
  profileId: uuid('profile_id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  phone: text('phone').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Encrypted by the application (`SensitiveCipher`): the database only ever holds ciphertext and the fingerprint (INV-18, INV-24). */
export const rescuerSensitive = pgTable('rescuer_sensitive', {
  profileId: uuid('profile_id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  documentType: documentType('document_type').notNull(),
  documentEnc: bytea('document_enc').notNull(),
  documentHash: bytea('document_hash').notNull(),
  addressEnc: bytea('address_enc').notNull(),
  keyId: smallint('key_id').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  profileId: uuid('profile_id').notNull(),
  name: text('name').notNull(),
  kind: skillKind('kind').notNull(),
  issuer: text('issuer'),
  issuedOn: date('issued_on', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }),
  certificateFileId: uuid('certificate_file_id'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  locality: text('locality').notNull(),
  code: text('code').notNull(),
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

export const missions = pgTable('missions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  coordinatorId: uuid('coordinator_id').notNull(),
  status: missionStatus('status').notNull().default('planning'),
  target: pointZ('target').notNull(),
  targetLabel: text('target_label'),
  targetCountry: char('target_country', { length: 2 }),
  targetSource: targetSource('target_source').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  activatedAt: timestamptz('activated_at'),
  closedAt: timestamptz('closed_at'),
});

export const missionPoints = pgTable('mission_points', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  missionId: uuid('mission_id').notNull(),
  kind: pointKind('kind').notNull(),
  name: text('name').notNull(),
  note: text('note'),
  geom: pointZ('geom').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  ownerUserId: uuid('owner_user_id'),
  purpose: filePurpose('purpose').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  sha256: bytea('sha256').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  organizationId: uuid('organization_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  action: text('action').notNull(),
  actorUserId: uuid('actor_user_id'),
  subjectUserId: uuid('subject_user_id'),
  occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  detail: jsonb('detail').notNull().default({}),
});

export const enums = { accountStatus, memberRole, memberStatus, profileStatus, documentType, skillKind, teamStatus, missionStatus, pointKind, targetSource, filePurpose };

export const schema = { organizations, users, sessions, memberships, rescuerProfiles, rescuerContact, rescuerSensitive, skills, teams, teamMembers, missions, missionPoints, files, auditLog };
