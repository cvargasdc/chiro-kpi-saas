import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  integer,
  real,
  date,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Path B schema — full PHI from day one.
 *
 * Isolation keys: every PHI table has org_id AND practice_id with NO default.
 * The legacy `"default"` practiceId default is intentionally absent.
 *
 * Tenant model:
 *   organizations (legal entity / BAA counterparty)
 *     └── practices (clinic / location)
 *           └── PHI rows (patients, intakes, daily_stats, goals, audit_logs)
 *
 * Memberships carry RBAC: owner | admin | clinician | staff | readonly
 */

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "clinician",
  "staff",
  "readonly",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "active",
  "invited",
  "revoked",
]);

export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "suspended",
  "disabled",
]);

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  status: accountStatusEnum("status").notNull().default("active"),
  billingCustomerId: text("billing_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const practices = pgTable(
  "practices",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    status: accountStatusEnum("status").notNull().default("active"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("practices_org_id_idx").on(table.orgId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    status: accountStatusEnum("status").notNull().default("active"),
    // TOTP MFA. Secret is AES-256-GCM ciphertext (see MFA_ENCRYPTION_KEY).
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaMethod: text("mfa_method"),
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
    mfaRecoveryCodesHash: text("mfa_recovery_codes_hash"),
    mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
    credentialsChangedAt: timestamp("credentials_changed_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_username_unique").on(table.username),
  ],
);

export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("org_memberships_user_org_unique").on(table.userId, table.orgId),
    index("org_memberships_org_id_idx").on(table.orgId),
  ],
);

export const practiceMemberships = pgTable(
  "practice_memberships",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("practice_memberships_user_practice_unique").on(
      table.userId,
      table.practiceId,
    ),
    index("practice_memberships_practice_id_idx").on(table.practiceId),
    index("practice_memberships_org_id_idx").on(table.orgId),
  ],
);

/**
 * connect-pg-simple session store. Session payloads hold workforce identity
 * (userId + active tenant), not patient PHI.
 */
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

/**
 * Password-reset tokens. Store only the SHA-256 of the raw token.
 * Not PHI — workforce account recovery.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_id_idx").on(table.userId),
  ],
);

/**
 * Practice team invites. Workforce email, not patient PHI.
 * Isolation: org_id + practice_id required (no "default").
 */
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    role: membershipRoleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedBy: varchar("invited_by")
      .notNull()
      .references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: varchar("accepted_by_user_id").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("team_invitations_token_hash_unique").on(table.tokenHash),
    index("team_invitations_practice_id_idx").on(table.practiceId),
    index("team_invitations_org_id_idx").on(table.orgId),
    index("team_invitations_email_idx").on(table.email),
  ],
);

/* -------------------------------------------------------------------------- */
/* PHI tables — org_id + practice_id required, no "default" practiceId         */
/* -------------------------------------------------------------------------- */

export const patients = pgTable(
  "patients",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    dateOfBirth: date("date_of_birth"),
    condition: text("condition"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patients_org_practice_idx").on(table.orgId, table.practiceId),
    index("patients_practice_id_idx").on(table.practiceId),
  ],
);

export const patientIntakes = pgTable(
  "patient_intakes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    patientId: varchar("patient_id").references(() => patients.id),
    name: text("name").notNull(),
    typeName: text("type_name"),
    category: text("category").notNull().default("new"),
    day1Date: date("day1_date"),
    day2Date: date("day2_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patient_intakes_org_practice_idx").on(table.orgId, table.practiceId),
  ],
);

export const dailyStats = pgTable(
  "daily_stats",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    date: date("date").notNull(),
    totalAppointments: integer("total_appointments").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("daily_stats_org_practice_idx").on(table.orgId, table.practiceId),
    index("daily_stats_practice_date_idx").on(table.practiceId, table.date),
  ],
);

export const goals = pgTable(
  "goals",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    name: text("name").notNull(),
    metricType: text("metric_type").notNull(),
    targetValue: real("target_value").notNull(),
    timePeriod: text("time_period").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("goals_org_practice_idx").on(table.orgId, table.practiceId),
  ],
);

/**
 * Append-only audit log. Retention intent: 6 years (HIPAA §164.530(j)).
 * Automated prune is NOT enabled in Week 2.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    actorId: varchar("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: varchar("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_org_practice_idx").on(table.orgId, table.practiceId),
    index("audit_logs_created_at_idx").on(table.createdAt),
    index("audit_logs_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Practice = typeof practices.$inferSelect;
export type NewPractice = typeof practices.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OrgMembership = typeof orgMemberships.$inferSelect;
export type PracticeMembership = typeof practiceMemberships.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
export type PatientIntake = typeof patientIntakes.$inferSelect;
export type DailyStat = typeof dailyStats.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type TeamInvitation = typeof teamInvitations.$inferSelect;
