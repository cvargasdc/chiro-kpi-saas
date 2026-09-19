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
 *           └── PHI / tenant rows (patients, intakes, referral_sources,
 *               daily_stats, goals, treatments, audit_logs)
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

/**
 * Stripe subscription lifecycle. Billing is per organization (not per practice).
 * Never store patient PHI on this table or send it to Stripe.
 */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    status: accountStatusEnum("status").notNull().default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: text("plan"),
    subscriptionStatus: subscriptionStatusEnum("subscription_status")
      .notNull()
      .default("incomplete"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organizations_stripe_customer_id_unique").on(table.stripeCustomerId),
    uniqueIndex("organizations_stripe_subscription_id_unique").on(
      table.stripeSubscriptionId,
    ),
  ],
);

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

/**
 * Practice-scoped referral catalog (e.g. "Google", "Patient"). Not PHI by
 * itself; still requires org_id + practice_id (no "default").
 */
export const referralSources = pgTable(
  "referral_sources",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("referral_sources_org_practice_idx").on(table.orgId, table.practiceId),
    uniqueIndex("referral_sources_practice_name_unique").on(
      table.practiceId,
      table.name,
    ),
  ],
);

/**
 * Unified patient + conversion-funnel row (Week 8).
 *
 * Legacy split `patients` vs `patient_intakes` is collapsed here so a person
 * is one PHI record. `patient_intakes` is reserved for later onboarding /
 * checklists and is not the operational list.
 *
 * Encrypted at rest (PHI_ENCRYPTION_KEY, AES-256-GCM): email, phone,
 * dateOfBirth, notes. date_of_birth is text (not date) so the envelope fits.
 * RDS encryption-at-rest is still required.
 *
 * Patient onboarding lives on `checklist_templates` / `patient_checklists`
 * (Week 10), not on this row. Practice Checklists are a separate ops feature.
 */
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
    dateOfBirth: text("date_of_birth"),
    condition: text("condition"),
    // Record status: active | inactive. Distinct from careStatus (funnel).
    status: text("status").notNull().default("active"),
    // new | wellness
    patientType: text("patient_type").notNull().default("new"),
    typeName: text("type_name"),
    referralSourceId: varchar("referral_source_id").references(
      () => referralSources.id,
    ),
    // Denormalized catalog name (or free-text) for leaderboard grouping.
    referralSource: text("referral_source"),
    day1Date: date("day1_date"),
    day2Date: date("day2_date"),
    // new | in_care | wellness | discharged | lost
    careStatus: text("care_status").notNull().default("new"),
    converted: boolean("converted").notNull().default(false),
    conversionDate: date("conversion_date"),
    planType: text("plan_type"),
    notes: text("notes"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patients_org_practice_idx").on(table.orgId, table.practiceId),
    index("patients_practice_id_idx").on(table.practiceId),
    index("patients_practice_type_idx").on(table.practiceId, table.patientType),
    index("patients_practice_day1_idx").on(table.practiceId, table.day1Date),
  ],
);

/**
 * Reserved for future onboarding / checklist flows. Conversion funnel fields
 * live on `patients` (unified in Week 8) so a person is one PHI row.
 * org_id + practice_id required; no "default".
 */
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

/**
 * One row per practice calendar date (Daily Log).
 *
 * - visits: whole-number patient visits, ≥ 0
 * - revenue_cents: integer USD cents, ≥ 0 (API exposes dollars as `revenue`)
 * - notes: optional free-text; AES-256-GCM at rest (PHI_ENCRYPTION_KEY).
 *   Treat as possible PHI. Audit logs record field names, never note contents.
 * Unique (practice_id, date). org_id + practice_id required; no "default".
 */
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
    visits: integer("visits").notNull().default(0),
    revenueCents: integer("revenue_cents").notNull().default(0),
    // Ciphertext when PHI_ENCRYPTION_KEY is set.
    notes: text("notes"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("daily_stats_org_practice_idx").on(table.orgId, table.practiceId),
    uniqueIndex("daily_stats_practice_date_unique").on(table.practiceId, table.date),
  ],
);

/**
 * Practice goals (revenue / visits / custom).
 *
 * - org_id + practice_id required; no "default".
 * - target_value is integer USD cents when metric_type = "revenue",
 *   otherwise an integer count. See docs/WEEK7-GOALS.md.
 * - current_value is stored only for custom metrics. Revenue and visits
 *   are summed from daily_stats at read time (not stored, not stale).
 * - status is derived (Achieved / Expired / Below Target / Behind Pace / On Pace).
 * - notes: optional free-text; AES-256-GCM at rest. Treat as possible PHI.
 */
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
    // revenue | visits | custom
    metricType: text("metric_type").notNull(),
    // Integer cents for revenue; integer count otherwise.
    targetValue: integer("target_value").notNull(),
    // Manual current for custom only. Null for revenue/visits.
    currentValue: integer("current_value"),
    timePeriod: text("time_period").notNull().default("custom"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    notes: text("notes"),
    createdBy: varchar("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("goals_org_practice_idx").on(table.orgId, table.practiceId),
    index("goals_practice_dates_idx").on(table.practiceId, table.startDate, table.endDate),
  ],
);

/**
 * Practice services / treatments catalog (Week 9).
 *
 * Not patient PHI by itself (no names or clinical notes); still requires
 * org_id + practice_id with no `"default"`. Care Plan Generator may consume
 * this catalog later — this table is the list + price book only.
 *
 * - price_cents: integer USD cents, ≥ 0
 * - category: free-text label (UI suggests Adjustment, Therapy, Exam, …)
 * - active: soft-hide from the default list without deleting
 * - sort_order: optional display order within a category (lower first)
 */
export const treatments = pgTable(
  "treatments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("treatments_org_practice_idx").on(table.orgId, table.practiceId),
    index("treatments_practice_category_idx").on(table.practiceId, table.category),
    index("treatments_practice_active_idx").on(table.practiceId, table.active),
  ],
);

/**
 * Practice Checklists — clinic daily/weekly ops tasks (Week 10).
 *
 * Not patient onboarding. Not PHI by itself (no patient names or clinical
 * notes); still requires org_id + practice_id with no `"default"`.
 * Cadence is daily | weekly.
 */
export const practiceChecklists = pgTable(
  "practice_checklists",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    name: text("name").notNull(),
    // daily | weekly
    cadence: text("cadence").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("practice_checklists_org_practice_idx").on(table.orgId, table.practiceId),
    index("practice_checklists_practice_active_idx").on(table.practiceId, table.active),
  ],
);

export const practiceChecklistItems = pgTable(
  "practice_checklist_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    checklistId: varchar("checklist_id")
      .notNull()
      .references(() => practiceChecklists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull().default("Other"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("practice_checklist_items_org_practice_idx").on(
      table.orgId,
      table.practiceId,
    ),
    index("practice_checklist_items_checklist_idx").on(table.checklistId),
  ],
);

/**
 * One completion row per item per canonical date (daily = that date;
 * weekly = Monday of the UTC ISO week). `completed` can be flipped false.
 */
export const practiceChecklistCompletions = pgTable(
  "practice_checklist_completions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    itemId: varchar("item_id")
      .notNull()
      .references(() => practiceChecklistItems.id, { onDelete: "cascade" }),
    completedOn: date("completed_on").notNull(),
    completedBy: varchar("completed_by"),
    completed: boolean("completed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("practice_checklist_completions_org_practice_idx").on(
      table.orgId,
      table.practiceId,
    ),
    uniqueIndex("practice_checklist_completions_item_date_unique").on(
      table.practiceId,
      table.itemId,
      table.completedOn,
    ),
  ],
);

/**
 * Patient Onboarding templates (Week 10). Distinct from Practice Checklists.
 * patient_type: new | wellness | all.
 */
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    name: text("name").notNull(),
    // new | wellness | all
    patientType: text("patient_type").notNull().default("all"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("checklist_templates_org_practice_idx").on(table.orgId, table.practiceId),
    index("checklist_templates_practice_active_idx").on(table.practiceId, table.active),
  ],
);

export const checklistTemplateTasks = pgTable(
  "checklist_template_tasks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    templateId: varchar("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("checklist_template_tasks_org_practice_idx").on(
      table.orgId,
      table.practiceId,
    ),
    index("checklist_template_tasks_template_idx").on(table.templateId),
  ],
);

/**
 * Per-patient onboarding instance. Notes are AES-256-GCM at rest
 * (PHI_ENCRYPTION_KEY). Audit logs record field names, never note contents
 * or patient names.
 */
export const patientChecklists = pgTable(
  "patient_checklists",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    patientId: varchar("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    templateId: varchar("template_id").references(() => checklistTemplates.id),
    // Snapshot of the template name at assign time (not PHI).
    templateName: text("template_name").notNull(),
    // not_started | in_progress | complete
    status: text("status").notNull().default("not_started"),
    // Ciphertext when PHI_ENCRYPTION_KEY is set.
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patient_checklists_org_practice_idx").on(table.orgId, table.practiceId),
    index("patient_checklists_patient_idx").on(table.patientId),
    index("patient_checklists_template_idx").on(table.templateId),
  ],
);

/**
 * Copied from the template at assign time. Notes encrypted at rest.
 * Task text may describe patient care — treat as possible PHI; do not put
 * titles or notes in audit metadata.
 */
export const patientChecklistTasks = pgTable(
  "patient_checklist_tasks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id),
    practiceId: varchar("practice_id")
      .notNull()
      .references(() => practices.id),
    patientChecklistId: varchar("patient_checklist_id")
      .notNull()
      .references(() => patientChecklists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    assigneeName: text("assignee_name"),
    // Ciphertext when PHI_ENCRYPTION_KEY is set.
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patient_checklist_tasks_org_practice_idx").on(
      table.orgId,
      table.practiceId,
    ),
    index("patient_checklist_tasks_checklist_idx").on(table.patientChecklistId),
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
export type ReferralSource = typeof referralSources.$inferSelect;
export type NewReferralSource = typeof referralSources.$inferInsert;
export type DailyStat = typeof dailyStats.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Treatment = typeof treatments.$inferSelect;
export type NewTreatment = typeof treatments.$inferInsert;
export type PracticeChecklist = typeof practiceChecklists.$inferSelect;
export type PracticeChecklistItem = typeof practiceChecklistItems.$inferSelect;
export type PracticeChecklistCompletion =
  typeof practiceChecklistCompletions.$inferSelect;
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type ChecklistTemplateTask = typeof checklistTemplateTasks.$inferSelect;
export type PatientChecklist = typeof patientChecklists.$inferSelect;
export type PatientChecklistTask = typeof patientChecklistTasks.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type TeamInvitation = typeof teamInvitations.$inferSelect;
