import { and, asc, count, desc, eq, gte, gt, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { MembershipRole } from "@shared/roles";
import {
  DEFAULT_PAYMENT_SETTINGS,
  normalizePaymentSettings,
  normalizeTreatmentSelections,
  type CarePlanPaymentSettings,
  type CarePlanStatus,
  type CarePlanTemplateSelections,
  type CarePlanTreatmentSelection,
} from "@shared/care-plans";
import {
  decryptStoredCarePlan,
  decryptStoredDailyStat,
  decryptStoredGoal,
  decryptStoredImportRow,
  decryptStoredPatient,
  decryptStoredPatientChecklist,
  decryptStoredPatientChecklistTask,
  decryptStoredProjectTask,
  encryptCarePlanSensitiveFields,
  encryptPhiString,
  encryptPhiStringIfKeyed,
} from "../crypto/fields";
import { DuplicateDailyLogError } from "../daily-log/errors";
import { requireOrgId, requireTenantScope, type TenantScope } from "../tenant/scope";
import type { AuditLogQuery } from "./audit-query";
import type {
  AppStorage,
  DailyStatPatch,
  DailyStatRange,
  DailyStatWrite,
  GoalPatch,
  GoalWrite,
  NewAuditLog,
  OrganizationPatch,
  PatientWrite,
  StoredAuditLog,
  StoredDailyStat,
  StoredGoal,
  StoredInvitation,
  StoredOrgMembership,
  StoredOrganization,
  StoredPasswordResetToken,
  StoredPatient,
  StoredPractice,
  StoredPracticeMembership,
  StoredReferralSource,
  StoredTreatment,
  StoredUser,
  TreatmentPatch,
  TreatmentWrite,
  UserPatch,
  StoredPracticeSettings,
  PracticeSettingsPatch,
  StoredCarePlanComplianceAck,
  StoredCarePlanTemplate,
  CarePlanTemplateWrite,
  CarePlanTemplatePatch,
  StoredCarePlan,
  CarePlanWrite,
  CarePlanPatch,
  StoredPracticeChecklist,
  PracticeChecklistWrite,
  PracticeChecklistPatch,
  StoredPracticeChecklistItem,
  PracticeChecklistItemWrite,
  PracticeChecklistItemPatch,
  StoredPracticeChecklistCompletion,
  PracticeChecklistCompletionWrite,
  StoredChecklistTemplate,
  ChecklistTemplateWrite,
  ChecklistTemplatePatch,
  StoredChecklistTemplateTask,
  ChecklistTemplateTaskWrite,
  ChecklistTemplateTaskPatch,
  StoredPatientChecklist,
  PatientChecklistWrite,
  PatientChecklistPatch,
  StoredPatientChecklistTask,
  PatientChecklistTaskWrite,
  PatientChecklistTaskPatch,
  StoredProject,
  ProjectWrite,
  ProjectPatch,
  StoredProjectColumn,
  ProjectColumnWrite,
  ProjectColumnPatch,
  StoredProjectTask,
  ProjectTaskWrite,
  ProjectTaskPatch,
  StoredAdvancedMetricInput,
  AdvancedMetricInputWrite,
  StoredImportBatch,
  ImportBatchWrite,
  ImportBatchPatch,
  StoredImportRow,
  ImportRowWrite,
  ImportRowPatch,
} from "./types";

type Db = NodePgDatabase<typeof schema>;

function mapUser(row: schema.User): StoredUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    status: row.status,
    mfaEnabled: row.mfaEnabled,
    mfaMethod: row.mfaMethod,
    mfaSecretEnc: row.mfaSecretEnc,
    mfaPendingSecretEnc: row.mfaPendingSecretEnc,
    mfaRecoveryCodesHash: row.mfaRecoveryCodesHash,
    mfaEnrolledAt: row.mfaEnrolledAt,
    credentialsChangedAt: row.credentialsChangedAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

function mapOrganization(row: schema.Organization): StoredOrganization {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    plan: row.plan,
    subscriptionStatus: row.subscriptionStatus,
    trialEndsAt: row.trialEndsAt,
    createdAt: row.createdAt,
  };
}

function mapInvitation(row: schema.TeamInvitation): StoredInvitation {
  return {
    id: row.id,
    email: row.email,
    orgId: row.orgId,
    practiceId: row.practiceId,
    role: row.role,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    invitedBy: row.invitedBy,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function isPendingInvitation(row: StoredInvitation, nowDate: Date): boolean {
  return !row.acceptedAt && !row.revokedAt && row.expiresAt.getTime() > nowDate.getTime();
}

function isPgUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: string }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

function mapGoalRow(row: schema.Goal): StoredGoal {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    metricType: row.metricType,
    targetValue: row.targetValue,
    currentValue: row.currentValue ?? null,
    timePeriod: row.timePeriod,
    startDate: row.startDate,
    endDate: row.endDate,
    notes: row.notes ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDailyStatRow(row: schema.DailyStat): StoredDailyStat {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    date: row.date,
    visits: row.visits,
    revenueCents: row.revenueCents,
    notes: row.notes,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPatientRow(row: schema.Patient): StoredPatient {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.dateOfBirth,
    condition: row.condition,
    status: row.status,
    patientType: row.patientType,
    typeName: row.typeName ?? null,
    referralSourceId: row.referralSourceId ?? null,
    referralSource: row.referralSource ?? null,
    day1Date: row.day1Date ?? null,
    day2Date: row.day2Date ?? null,
    careStatus: row.careStatus,
    converted: row.converted,
    conversionDate: row.conversionDate ?? null,
    planType: row.planType ?? null,
    notes: row.notes ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapReferralSourceRow(row: schema.ReferralSource): StoredReferralSource {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTreatmentRow(row: schema.Treatment): StoredTreatment {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    description: row.description ?? null,
    category: row.category,
    priceCents: row.priceCents,
    active: row.active,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseSelections(value: unknown): CarePlanTreatmentSelection[] {
  const parsed = normalizeTreatmentSelections(value);
  return parsed.ok ? parsed.selections : [];
}

function parsePaymentSettings(value: unknown): CarePlanPaymentSettings {
  const parsed = normalizePaymentSettings(value);
  return parsed.ok ? parsed.settings : { ...DEFAULT_PAYMENT_SETTINGS };
}

function parseTemplateSelections(value: unknown): CarePlanTemplateSelections {
  const obj =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    treatmentSelections: parseSelections(obj.treatmentSelections ?? obj),
    paymentSettings: parsePaymentSettings(obj.paymentSettings),
  };
}

function mapPracticeSettingsRow(
  row: schema.PracticeSettings,
): StoredPracticeSettings {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    carePlanTerms: row.carePlanTerms ?? null,
    complianceNotice: row.complianceNotice ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCarePlanComplianceAckRow(
  row: schema.CarePlanComplianceAck,
): StoredCarePlanComplianceAck {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    userId: row.userId,
    acknowledgedAt: row.acknowledgedAt,
  };
}

function mapCarePlanTemplateRow(
  row: schema.CarePlanTemplate,
): StoredCarePlanTemplate {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    defaultSelections: parseTemplateSelections(row.defaultSelections),
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCarePlanRow(row: schema.CarePlan): StoredCarePlan {
  const status: CarePlanStatus = row.status === "final" ? "final" : "draft";
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    patientId: row.patientId ?? null,
    firstName: row.firstNameEnc,
    lastName: row.lastNameEnc,
    notes: row.notesEnc ?? null,
    treatmentSelections: parseSelections(row.treatmentSelections),
    paymentSettings: parsePaymentSettings(row.paymentSettings),
    subtotalCents: row.subtotalCents,
    status,
    complianceAcknowledgedAt: row.complianceAcknowledgedAt ?? null,
    complianceAcknowledgedBy: row.complianceAcknowledgedBy ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPracticeChecklistRow(
  row: schema.PracticeChecklist,
): StoredPracticeChecklist {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    cadence: row.cadence,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPracticeChecklistItemRow(
  row: schema.PracticeChecklistItem,
): StoredPracticeChecklistItem {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    checklistId: row.checklistId,
    title: row.title,
    category: row.category,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPracticeChecklistCompletionRow(
  row: schema.PracticeChecklistCompletion,
): StoredPracticeChecklistCompletion {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    itemId: row.itemId,
    completedOn: row.completedOn,
    completedBy: row.completedBy ?? null,
    completed: row.completed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapChecklistTemplateRow(
  row: schema.ChecklistTemplate,
): StoredChecklistTemplate {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    patientType: row.patientType,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapChecklistTemplateTaskRow(
  row: schema.ChecklistTemplateTask,
): StoredChecklistTemplateTask {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    templateId: row.templateId,
    title: row.title,
    description: row.description ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPatientChecklistRow(
  row: schema.PatientChecklist,
): StoredPatientChecklist {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    patientId: row.patientId,
    templateId: row.templateId ?? null,
    templateName: row.templateName,
    status: row.status,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapPatientChecklistTaskRow(
  row: schema.PatientChecklistTask,
): StoredPatientChecklistTask {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    patientChecklistId: row.patientChecklistId,
    title: row.title,
    done: row.done,
    assigneeName: row.assigneeName ?? null,
    notes: row.notes ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProjectRow(row: schema.Project): StoredProject {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    tags: Array.isArray(row.tags) ? [...row.tags] : [],
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProjectColumnRow(row: schema.ProjectColumn): StoredProjectColumn {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    projectId: row.projectId,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAdvancedMetricInputRow(
  row: schema.AdvancedMetricsInput,
): StoredAdvancedMetricInput {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    periodMonth: row.periodMonth,
    section: row.section,
    key: row.key,
    valueNumeric: row.valueNumeric ?? null,
    valueText: row.valueText ?? null,
    source: row.source,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapImportBatchRow(row: schema.ImportBatch): StoredImportBatch {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    fileName: row.fileName,
    fileType: row.fileType,
    status: row.status,
    totalRows: row.totalRows,
    successRows: row.successRows,
    errorRows: row.errorRows,
    skippedRows: row.skippedRows,
    columnMapping: Array.isArray(row.columnMapping)
      ? [...row.columnMapping]
      : null,
    headers: Array.isArray(row.headers) ? [...row.headers] : null,
    importType: row.importType,
    createdBy: row.createdBy ?? null,
    errorSummary: row.errorSummary ?? null,
    committedAt: row.committedAt ?? null,
    rawExpiresAt: row.rawExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapImportRow(row: schema.ImportRow): StoredImportRow {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    batchId: row.batchId,
    rowNumber: row.rowNumber,
    rawData: row.rawData,
    normalizedData: row.normalizedData ?? null,
    status: row.status,
    errorMessage: row.errorMessage ?? null,
    targetEntityType: row.targetEntityType ?? null,
    targetEntityId: row.targetEntityId ?? null,
    contentHash: row.contentHash ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProjectTaskRow(row: schema.ProjectTask): StoredProjectTask {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    projectId: row.projectId,
    columnId: row.columnId,
    title: row.title,
    notes: row.notes ?? null,
    sortOrder: row.sortOrder,
    done: row.done,
    dueDate: row.dueDate ?? null,
    assigneeName: row.assigneeName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleStorage implements AppStorage {
  private readonly phiEncryptionKey: string;

  constructor(
    private readonly db: Db,
    opts?: { phiEncryptionKey?: string },
  ) {
    this.phiEncryptionKey =
      opts?.phiEncryptionKey ?? process.env.PHI_ENCRYPTION_KEY ?? "";
  }

  private revealPatient(row: schema.Patient): StoredPatient {
    return decryptStoredPatient(mapPatientRow(row), this.phiEncryptionKey);
  }

  private revealDailyStat(row: schema.DailyStat): StoredDailyStat {
    return decryptStoredDailyStat(mapDailyStatRow(row), this.phiEncryptionKey);
  }

  private revealGoal(row: schema.Goal): StoredGoal {
    return decryptStoredGoal(mapGoalRow(row), this.phiEncryptionKey);
  }

  private revealCarePlan(row: schema.CarePlan): StoredCarePlan {
    return decryptStoredCarePlan(mapCarePlanRow(row), this.phiEncryptionKey);
  }

  private revealPatientChecklist(
    row: schema.PatientChecklist,
  ): StoredPatientChecklist {
    return decryptStoredPatientChecklist(
      mapPatientChecklistRow(row),
      this.phiEncryptionKey,
    );
  }

  private revealPatientChecklistTask(
    row: schema.PatientChecklistTask,
  ): StoredPatientChecklistTask {
    return decryptStoredPatientChecklistTask(
      mapPatientChecklistTaskRow(row),
      this.phiEncryptionKey,
    );
  }

  private revealProjectTask(row: schema.ProjectTask): StoredProjectTask {
    return decryptStoredProjectTask(
      mapProjectTaskRow(row),
      this.phiEncryptionKey,
    );
  }

  async createUser(input: {
    email: string;
    username: string;
    passwordHash: string;
    displayName: string;
  }): Promise<StoredUser> {
    const [row] = await this.db
      .insert(schema.users)
      .values({
        email: input.email,
        username: input.username,
        passwordHash: input.passwordHash,
        displayName: input.displayName,
      })
      .returning();
    return mapUser(row);
  }

  async getUserById(id: string): Promise<StoredUser | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return row ? mapUser(row) : undefined;
  }

  async getUserByEmail(email: string): Promise<StoredUser | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);
    return row ? mapUser(row) : undefined;
  }

  async getUserByUsername(username: string): Promise<StoredUser | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username.toLowerCase()))
      .limit(1);
    return row ? mapUser(row) : undefined;
  }

  async getUserByLogin(login: string): Promise<StoredUser | undefined> {
    const needle = login.trim().toLowerCase();
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(
        or(eq(schema.users.email, needle), eq(schema.users.username, needle)),
      )
      .limit(1);
    return row ? mapUser(row) : undefined;
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.db
      .update(schema.users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  async updateUser(id: string, patch: UserPatch): Promise<StoredUser | undefined> {
    const existing = await this.getUserById(id);
    if (!existing) return undefined;
    const [row] = await this.db
      .update(schema.users)
      .set({
        passwordHash: patch.passwordHash ?? existing.passwordHash,
        displayName: patch.displayName ?? existing.displayName,
        status: patch.status ?? existing.status,
        mfaEnabled: patch.mfaEnabled ?? existing.mfaEnabled,
        mfaMethod: patch.mfaMethod === undefined ? existing.mfaMethod : patch.mfaMethod,
        mfaSecretEnc:
          patch.mfaSecretEnc === undefined ? existing.mfaSecretEnc : patch.mfaSecretEnc,
        mfaPendingSecretEnc:
          patch.mfaPendingSecretEnc === undefined
            ? existing.mfaPendingSecretEnc
            : patch.mfaPendingSecretEnc,
        mfaRecoveryCodesHash:
          patch.mfaRecoveryCodesHash === undefined
            ? existing.mfaRecoveryCodesHash
            : patch.mfaRecoveryCodesHash,
        mfaEnrolledAt:
          patch.mfaEnrolledAt === undefined ? existing.mfaEnrolledAt : patch.mfaEnrolledAt,
        credentialsChangedAt:
          patch.credentialsChangedAt === undefined
            ? existing.credentialsChangedAt
            : patch.credentialsChangedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .returning();
    return row ? mapUser(row) : undefined;
  }

  async createOrganization(input: { name: string }): Promise<StoredOrganization> {
    const [row] = await this.db
      .insert(schema.organizations)
      .values({ name: input.name })
      .returning();
    return mapOrganization(row);
  }

  async getOrganization(id: string): Promise<StoredOrganization | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);
    return row ? mapOrganization(row) : undefined;
  }

  async updateOrganization(
    id: string,
    patch: OrganizationPatch,
  ): Promise<StoredOrganization | undefined> {
    const existing = await this.getOrganization(id);
    if (!existing) return undefined;
    const [row] = await this.db
      .update(schema.organizations)
      .set({
        name: patch.name ?? existing.name,
        status: patch.status ?? existing.status,
        stripeCustomerId:
          patch.stripeCustomerId === undefined
            ? existing.stripeCustomerId
            : patch.stripeCustomerId,
        stripeSubscriptionId:
          patch.stripeSubscriptionId === undefined
            ? existing.stripeSubscriptionId
            : patch.stripeSubscriptionId,
        plan: patch.plan === undefined ? existing.plan : patch.plan,
        subscriptionStatus: patch.subscriptionStatus ?? existing.subscriptionStatus,
        trialEndsAt:
          patch.trialEndsAt === undefined ? existing.trialEndsAt : patch.trialEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.organizations.id, id))
      .returning();
    return row ? mapOrganization(row) : undefined;
  }

  async getOrganizationByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<StoredOrganization | undefined> {
    if (!stripeCustomerId) return undefined;
    const [row] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.stripeCustomerId, stripeCustomerId))
      .limit(1);
    return row ? mapOrganization(row) : undefined;
  }

  async getOrganizationByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<StoredOrganization | undefined> {
    if (!stripeSubscriptionId) return undefined;
    const [row] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return row ? mapOrganization(row) : undefined;
  }

  async listPracticesForOrg(orgId: string): Promise<StoredPractice[]> {
    requireOrgId(orgId);
    const rows = await this.db
      .select()
      .from(schema.practices)
      .where(eq(schema.practices.orgId, orgId));
    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  async createPractice(input: {
    orgId: string;
    name: string;
  }): Promise<StoredPractice> {
    requireOrgId(input.orgId);
    const [row] = await this.db
      .insert(schema.practices)
      .values({ orgId: input.orgId, name: input.name })
      .returning();
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  async getPractice(id: string): Promise<StoredPractice | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.practices)
      .where(eq(schema.practices.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  async listPracticesForUser(
    userId: string,
  ): Promise<Array<StoredPractice & { role: MembershipRole }>> {
    const rows = await this.db
      .select({
        id: schema.practices.id,
        orgId: schema.practices.orgId,
        name: schema.practices.name,
        status: schema.practices.status,
        createdAt: schema.practices.createdAt,
        role: schema.practiceMemberships.role,
      })
      .from(schema.practiceMemberships)
      .innerJoin(
        schema.practices,
        eq(schema.practices.id, schema.practiceMemberships.practiceId),
      )
      .where(
        and(
          eq(schema.practiceMemberships.userId, userId),
          eq(schema.practiceMemberships.status, "active"),
          eq(schema.practices.status, "active"),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
      role: row.role,
    }));
  }

  async listOrganizationsForUser(
    userId: string,
  ): Promise<Array<StoredOrganization & { role: MembershipRole }>> {
    const rows = await this.db
      .select({
        org: schema.organizations,
        role: schema.orgMemberships.role,
      })
      .from(schema.orgMemberships)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.orgMemberships.orgId),
      )
      .where(
        and(
          eq(schema.orgMemberships.userId, userId),
          eq(schema.orgMemberships.status, "active"),
          eq(schema.organizations.status, "active"),
        ),
      );
    return rows.map((row) => ({
      ...mapOrganization(row.org),
      role: row.role,
    }));
  }

  async createOrgMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredOrgMembership> {
    const [row] = await this.db
      .insert(schema.orgMemberships)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        role: input.role,
        status: "active",
      })
      .returning();
    return {
      id: row.id,
      orgId: row.orgId,
      userId: row.userId,
      role: row.role,
      status: row.status,
    };
  }

  async getOrgMembership(
    userId: string,
    orgId: string,
  ): Promise<StoredOrgMembership | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.orgMemberships)
      .where(
        and(
          eq(schema.orgMemberships.userId, userId),
          eq(schema.orgMemberships.orgId, orgId),
          eq(schema.orgMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      orgId: row.orgId,
      userId: row.userId,
      role: row.role,
      status: row.status,
    };
  }

  async ensureOrgMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredOrgMembership> {
    const [existing] = await this.db
      .select()
      .from(schema.orgMemberships)
      .where(
        and(
          eq(schema.orgMemberships.userId, input.userId),
          eq(schema.orgMemberships.orgId, input.orgId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.status === "active") {
        return {
          id: existing.id,
          orgId: existing.orgId,
          userId: existing.userId,
          role: existing.role,
          status: existing.status,
        };
      }
      const [row] = await this.db
        .update(schema.orgMemberships)
        .set({ status: "active", role: input.role, acceptedAt: new Date() })
        .where(eq(schema.orgMemberships.id, existing.id))
        .returning();
      return {
        id: row.id,
        orgId: row.orgId,
        userId: row.userId,
        role: row.role,
        status: row.status,
      };
    }
    return this.createOrgMembership(input);
  }

  async createPracticeMembership(input: {
    orgId: string;
    practiceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredPracticeMembership> {
    const [row] = await this.db
      .insert(schema.practiceMemberships)
      .values({
        orgId: input.orgId,
        practiceId: input.practiceId,
        userId: input.userId,
        role: input.role,
        status: "active",
      })
      .returning();
    return {
      id: row.id,
      orgId: row.orgId,
      practiceId: row.practiceId,
      userId: row.userId,
      role: row.role,
      status: row.status,
    };
  }

  async getPracticeMembership(
    userId: string,
    practiceId: string,
  ): Promise<StoredPracticeMembership | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.practiceMemberships)
      .where(
        and(
          eq(schema.practiceMemberships.userId, userId),
          eq(schema.practiceMemberships.practiceId, practiceId),
          eq(schema.practiceMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      orgId: row.orgId,
      practiceId: row.practiceId,
      userId: row.userId,
      role: row.role,
      status: row.status,
    };
  }

  async ensurePracticeMembership(input: {
    orgId: string;
    practiceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredPracticeMembership> {
    const [existing] = await this.db
      .select()
      .from(schema.practiceMemberships)
      .where(
        and(
          eq(schema.practiceMemberships.userId, input.userId),
          eq(schema.practiceMemberships.practiceId, input.practiceId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.status === "active") {
        return {
          id: existing.id,
          orgId: existing.orgId,
          practiceId: existing.practiceId,
          userId: existing.userId,
          role: existing.role,
          status: existing.status,
        };
      }
      const [row] = await this.db
        .update(schema.practiceMemberships)
        .set({
          status: "active",
          role: input.role,
          orgId: input.orgId,
          acceptedAt: new Date(),
        })
        .where(eq(schema.practiceMemberships.id, existing.id))
        .returning();
      return {
        id: row.id,
        orgId: row.orgId,
        practiceId: row.practiceId,
        userId: row.userId,
        role: row.role,
        status: row.status,
      };
    }
    return this.createPracticeMembership(input);
  }

  async createPatient(
    scope: TenantScope,
    input: PatientWrite,
  ): Promise<StoredPatient> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.patients)
      .values({
        orgId,
        practiceId,
        name: input.name,
        email: encryptPhiString(input.email ?? null, this.phiEncryptionKey),
        phone: encryptPhiString(input.phone ?? null, this.phiEncryptionKey),
        dateOfBirth: encryptPhiString(
          input.dateOfBirth ?? null,
          this.phiEncryptionKey,
        ),
        condition: input.condition ?? null,
        status: input.status ?? "active",
        patientType: input.patientType ?? "new",
        typeName: input.typeName ?? null,
        referralSourceId: input.referralSourceId ?? null,
        referralSource: input.referralSource ?? null,
        day1Date: input.day1Date ?? null,
        day2Date: input.day2Date ?? null,
        careStatus: input.careStatus ?? "new",
        converted: input.converted ?? false,
        conversionDate: input.conversionDate ?? null,
        planType: input.planType ?? null,
        notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return this.revealPatient(row);
  }

  async getPatient(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatient | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.patients)
      .where(
        and(
          eq(schema.patients.id, id),
          eq(schema.patients.orgId, orgId),
          eq(schema.patients.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? this.revealPatient(row) : undefined;
  }

  async listPatients(scope: TenantScope): Promise<StoredPatient[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.patients)
      .where(
        and(
          eq(schema.patients.orgId, orgId),
          eq(schema.patients.practiceId, practiceId),
        ),
      );
    return rows.map((row) => this.revealPatient(row));
  }

  async updatePatient(
    scope: TenantScope,
    id: string,
    input: Partial<PatientWrite>,
  ): Promise<StoredPatient | undefined> {
    const existing = await this.getPatient(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.patients)
      .set({
        name: input.name ?? existing.name,
        email:
          input.email === undefined
            ? undefined
            : encryptPhiString(input.email, this.phiEncryptionKey),
        phone:
          input.phone === undefined
            ? undefined
            : encryptPhiString(input.phone, this.phiEncryptionKey),
        dateOfBirth:
          input.dateOfBirth === undefined
            ? undefined
            : encryptPhiString(input.dateOfBirth, this.phiEncryptionKey),
        condition:
          input.condition === undefined ? existing.condition : input.condition,
        status: input.status ?? existing.status,
        patientType: input.patientType ?? existing.patientType,
        typeName:
          input.typeName === undefined ? existing.typeName : input.typeName,
        referralSourceId:
          input.referralSourceId === undefined
            ? existing.referralSourceId
            : input.referralSourceId,
        referralSource:
          input.referralSource === undefined
            ? existing.referralSource
            : input.referralSource,
        day1Date:
          input.day1Date === undefined ? existing.day1Date : input.day1Date,
        day2Date:
          input.day2Date === undefined ? existing.day2Date : input.day2Date,
        careStatus: input.careStatus ?? existing.careStatus,
        converted:
          input.converted === undefined ? existing.converted : input.converted,
        conversionDate:
          input.conversionDate === undefined
            ? existing.conversionDate
            : input.conversionDate,
        planType:
          input.planType === undefined ? existing.planType : input.planType,
        notes:
          input.notes === undefined
            ? undefined
            : encryptPhiString(input.notes, this.phiEncryptionKey),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.patients.id, id),
          eq(schema.patients.orgId, orgId),
          eq(schema.patients.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? this.revealPatient(row) : undefined;
  }

  async deletePatient(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.patients)
      .where(
        and(
          eq(schema.patients.id, id),
          eq(schema.patients.orgId, orgId),
          eq(schema.patients.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.patients.id });
    return deleted.length > 0;
  }

  async listReferralSources(scope: TenantScope): Promise<StoredReferralSource[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.referralSources)
      .where(
        and(
          eq(schema.referralSources.orgId, orgId),
          eq(schema.referralSources.practiceId, practiceId),
        ),
      );
    return rows
      .map(mapReferralSourceRow)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getReferralSource(
    scope: TenantScope,
    id: string,
  ): Promise<StoredReferralSource | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.referralSources)
      .where(
        and(
          eq(schema.referralSources.id, id),
          eq(schema.referralSources.orgId, orgId),
          eq(schema.referralSources.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapReferralSourceRow(row) : undefined;
  }

  async createReferralSource(
    scope: TenantScope,
    input: { name: string; active?: boolean },
  ): Promise<StoredReferralSource> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.referralSources)
      .values({
        orgId,
        practiceId,
        name: input.name,
        active: input.active ?? true,
      })
      .returning();
    return mapReferralSourceRow(row);
  }

  async ensureReferralSource(
    scope: TenantScope,
    name: string,
  ): Promise<StoredReferralSource> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const trimmed = name.trim();
    const existing = (await this.listReferralSources(scope)).find(
      (row) => row.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      if (existing.active) return existing;
      const [row] = await this.db
        .update(schema.referralSources)
        .set({ active: true, updatedAt: new Date() })
        .where(
          and(
            eq(schema.referralSources.id, existing.id),
            eq(schema.referralSources.orgId, orgId),
            eq(schema.referralSources.practiceId, practiceId),
          ),
        )
        .returning();
      return row ? mapReferralSourceRow(row) : existing;
    }
    try {
      return await this.createReferralSource(scope, {
        name: trimmed,
        active: true,
      });
    } catch (err) {
      if (!isPgUniqueViolation(err)) throw err;
      const raced = (await this.listReferralSources(scope)).find(
        (row) => row.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (raced) return raced;
      throw err;
    }
  }

  async createDailyStat(
    scope: TenantScope,
    input: DailyStatWrite,
  ): Promise<StoredDailyStat> {
    const { orgId, practiceId } = requireTenantScope(scope);
    try {
      const [row] = await this.db
        .insert(schema.dailyStats)
        .values({
          orgId,
          practiceId,
          date: input.date,
          visits: input.visits,
          revenueCents: input.revenueCents,
          notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return this.revealDailyStat(row);
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        throw new DuplicateDailyLogError(input.date);
      }
      throw err;
    }
  }

  async getDailyStatByDate(
    scope: TenantScope,
    date: string,
  ): Promise<StoredDailyStat | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.dailyStats)
      .where(
        and(
          eq(schema.dailyStats.orgId, orgId),
          eq(schema.dailyStats.practiceId, practiceId),
          eq(schema.dailyStats.date, date),
        ),
      )
      .limit(1);
    return row ? this.revealDailyStat(row) : undefined;
  }

  async listDailyStats(
    scope: TenantScope,
    range?: DailyStatRange,
  ): Promise<StoredDailyStat[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.dailyStats.orgId, orgId),
      eq(schema.dailyStats.practiceId, practiceId),
    ];
    if (range?.from) {
      filters.push(gte(schema.dailyStats.date, range.from));
    }
    if (range?.to) {
      filters.push(lte(schema.dailyStats.date, range.to));
    }
    const rows = await this.db
      .select()
      .from(schema.dailyStats)
      .where(and(...filters))
      .orderBy(desc(schema.dailyStats.date));
    return rows.map((row) => this.revealDailyStat(row));
  }

  async updateDailyStatByDate(
    scope: TenantScope,
    date: string,
    input: DailyStatPatch,
  ): Promise<StoredDailyStat | undefined> {
    const existing = await this.getDailyStatByDate(scope, date);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.dailyStats)
      .set({
        visits: input.visits ?? existing.visits,
        revenueCents: input.revenueCents ?? existing.revenueCents,
        notes:
          input.notes === undefined
            ? undefined
            : encryptPhiString(input.notes, this.phiEncryptionKey),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.dailyStats.orgId, orgId),
          eq(schema.dailyStats.practiceId, practiceId),
          eq(schema.dailyStats.date, date),
        ),
      )
      .returning();
    return row ? this.revealDailyStat(row) : undefined;
  }

  async deleteDailyStatByDate(
    scope: TenantScope,
    date: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.dailyStats)
      .where(
        and(
          eq(schema.dailyStats.orgId, orgId),
          eq(schema.dailyStats.practiceId, practiceId),
          eq(schema.dailyStats.date, date),
        ),
      )
      .returning({ id: schema.dailyStats.id });
    return deleted.length > 0;
  }

  async createGoal(scope: TenantScope, input: GoalWrite): Promise<StoredGoal> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.goals)
      .values({
        orgId,
        practiceId,
        name: input.name,
        metricType: input.metricType,
        targetValue: input.targetValue,
        currentValue: input.currentValue ?? null,
        timePeriod: input.timePeriod ?? "custom",
        startDate: input.startDate,
        endDate: input.endDate,
        notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return this.revealGoal(row);
  }

  async getGoal(scope: TenantScope, id: string): Promise<StoredGoal | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.goals)
      .where(
        and(
          eq(schema.goals.id, id),
          eq(schema.goals.orgId, orgId),
          eq(schema.goals.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? this.revealGoal(row) : undefined;
  }

  async listGoals(scope: TenantScope): Promise<StoredGoal[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.goals)
      .where(
        and(eq(schema.goals.orgId, orgId), eq(schema.goals.practiceId, practiceId)),
      )
      .orderBy(
        desc(schema.goals.endDate),
        desc(schema.goals.startDate),
        schema.goals.name,
      );
    return rows.map((row) => this.revealGoal(row));
  }

  async updateGoal(
    scope: TenantScope,
    id: string,
    input: GoalPatch,
  ): Promise<StoredGoal | undefined> {
    const existing = await this.getGoal(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.goals)
      .set({
        name: input.name ?? existing.name,
        metricType: input.metricType ?? existing.metricType,
        targetValue: input.targetValue ?? existing.targetValue,
        currentValue:
          input.currentValue === undefined ? existing.currentValue : input.currentValue,
        timePeriod: input.timePeriod ?? existing.timePeriod,
        startDate: input.startDate ?? existing.startDate,
        endDate: input.endDate ?? existing.endDate,
        notes:
          input.notes === undefined
            ? undefined
            : encryptPhiString(input.notes, this.phiEncryptionKey),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.goals.id, id),
          eq(schema.goals.orgId, orgId),
          eq(schema.goals.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? this.revealGoal(row) : undefined;
  }

  async deleteGoal(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.goals)
      .where(
        and(
          eq(schema.goals.id, id),
          eq(schema.goals.orgId, orgId),
          eq(schema.goals.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.goals.id });
    return deleted.length > 0;
  }

  async createTreatment(
    scope: TenantScope,
    input: TreatmentWrite,
  ): Promise<StoredTreatment> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.treatments)
      .values({
        orgId,
        practiceId,
        name: input.name,
        description: input.description ?? null,
        category: input.category,
        priceCents: input.priceCents,
        active: input.active ?? true,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return mapTreatmentRow(row);
  }

  async getTreatment(
    scope: TenantScope,
    id: string,
  ): Promise<StoredTreatment | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.treatments)
      .where(
        and(
          eq(schema.treatments.id, id),
          eq(schema.treatments.orgId, orgId),
          eq(schema.treatments.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapTreatmentRow(row) : undefined;
  }

  async listTreatments(scope: TenantScope): Promise<StoredTreatment[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.treatments)
      .where(
        and(
          eq(schema.treatments.orgId, orgId),
          eq(schema.treatments.practiceId, practiceId),
        ),
      )
      .orderBy(
        schema.treatments.sortOrder,
        schema.treatments.category,
        schema.treatments.name,
      );
    return rows.map(mapTreatmentRow);
  }

  async updateTreatment(
    scope: TenantScope,
    id: string,
    input: TreatmentPatch,
  ): Promise<StoredTreatment | undefined> {
    const existing = await this.getTreatment(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.treatments)
      .set({
        name: input.name ?? existing.name,
        description:
          input.description === undefined ? existing.description : input.description,
        category: input.category ?? existing.category,
        priceCents: input.priceCents ?? existing.priceCents,
        active: input.active ?? existing.active,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.treatments.id, id),
          eq(schema.treatments.orgId, orgId),
          eq(schema.treatments.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapTreatmentRow(row) : undefined;
  }

  async deleteTreatment(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.treatments)
      .where(
        and(
          eq(schema.treatments.id, id),
          eq(schema.treatments.orgId, orgId),
          eq(schema.treatments.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.treatments.id });
    return deleted.length > 0;
  }

  async createPracticeChecklist(
    scope: TenantScope,
    input: PracticeChecklistWrite,
  ): Promise<StoredPracticeChecklist> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.practiceChecklists)
      .values({
        orgId,
        practiceId,
        name: input.name,
        cadence: input.cadence,
        active: input.active ?? true,
      })
      .returning();
    return mapPracticeChecklistRow(row);
  }

  async getPracticeChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPracticeChecklist | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.practiceChecklists)
      .where(
        and(
          eq(schema.practiceChecklists.id, id),
          eq(schema.practiceChecklists.orgId, orgId),
          eq(schema.practiceChecklists.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapPracticeChecklistRow(row) : undefined;
  }

  async listPracticeChecklists(
    scope: TenantScope,
  ): Promise<StoredPracticeChecklist[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.practiceChecklists)
      .where(
        and(
          eq(schema.practiceChecklists.orgId, orgId),
          eq(schema.practiceChecklists.practiceId, practiceId),
        ),
      )
      .orderBy(schema.practiceChecklists.name);
    return rows.map(mapPracticeChecklistRow);
  }

  async updatePracticeChecklist(
    scope: TenantScope,
    id: string,
    input: PracticeChecklistPatch,
  ): Promise<StoredPracticeChecklist | undefined> {
    const existing = await this.getPracticeChecklist(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.practiceChecklists)
      .set({
        name: input.name ?? existing.name,
        cadence: input.cadence ?? existing.cadence,
        active: input.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.practiceChecklists.id, id),
          eq(schema.practiceChecklists.orgId, orgId),
          eq(schema.practiceChecklists.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapPracticeChecklistRow(row) : undefined;
  }

  async deletePracticeChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.practiceChecklists)
      .where(
        and(
          eq(schema.practiceChecklists.id, id),
          eq(schema.practiceChecklists.orgId, orgId),
          eq(schema.practiceChecklists.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.practiceChecklists.id });
    return deleted.length > 0;
  }

  async createPracticeChecklistItem(
    scope: TenantScope,
    input: PracticeChecklistItemWrite,
  ): Promise<StoredPracticeChecklistItem> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.practiceChecklistItems)
      .values({
        orgId,
        practiceId,
        checklistId: input.checklistId,
        title: input.title,
        category: input.category,
        sortOrder: input.sortOrder ?? 0,
        active: input.active ?? true,
      })
      .returning();
    return mapPracticeChecklistItemRow(row);
  }

  async getPracticeChecklistItem(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPracticeChecklistItem | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.practiceChecklistItems)
      .where(
        and(
          eq(schema.practiceChecklistItems.id, id),
          eq(schema.practiceChecklistItems.orgId, orgId),
          eq(schema.practiceChecklistItems.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapPracticeChecklistItemRow(row) : undefined;
  }

  async listPracticeChecklistItems(
    scope: TenantScope,
    checklistId?: string,
  ): Promise<StoredPracticeChecklistItem[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.practiceChecklistItems.orgId, orgId),
      eq(schema.practiceChecklistItems.practiceId, practiceId),
    ];
    if (checklistId) {
      filters.push(eq(schema.practiceChecklistItems.checklistId, checklistId));
    }
    const rows = await this.db
      .select()
      .from(schema.practiceChecklistItems)
      .where(and(...filters))
      .orderBy(
        schema.practiceChecklistItems.sortOrder,
        schema.practiceChecklistItems.title,
      );
    return rows.map(mapPracticeChecklistItemRow);
  }

  async updatePracticeChecklistItem(
    scope: TenantScope,
    id: string,
    input: PracticeChecklistItemPatch,
  ): Promise<StoredPracticeChecklistItem | undefined> {
    const existing = await this.getPracticeChecklistItem(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.practiceChecklistItems)
      .set({
        title: input.title ?? existing.title,
        category: input.category ?? existing.category,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        active: input.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.practiceChecklistItems.id, id),
          eq(schema.practiceChecklistItems.orgId, orgId),
          eq(schema.practiceChecklistItems.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapPracticeChecklistItemRow(row) : undefined;
  }

  async deletePracticeChecklistItem(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.practiceChecklistItems)
      .where(
        and(
          eq(schema.practiceChecklistItems.id, id),
          eq(schema.practiceChecklistItems.orgId, orgId),
          eq(schema.practiceChecklistItems.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.practiceChecklistItems.id });
    return deleted.length > 0;
  }

  async getPracticeChecklistCompletion(
    scope: TenantScope,
    itemId: string,
    completedOn: string,
  ): Promise<StoredPracticeChecklistCompletion | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.practiceChecklistCompletions)
      .where(
        and(
          eq(schema.practiceChecklistCompletions.itemId, itemId),
          eq(schema.practiceChecklistCompletions.completedOn, completedOn),
          eq(schema.practiceChecklistCompletions.orgId, orgId),
          eq(schema.practiceChecklistCompletions.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapPracticeChecklistCompletionRow(row) : undefined;
  }

  async listPracticeChecklistCompletions(
    scope: TenantScope,
    range?: { from?: string; to?: string },
  ): Promise<StoredPracticeChecklistCompletion[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.practiceChecklistCompletions.orgId, orgId),
      eq(schema.practiceChecklistCompletions.practiceId, practiceId),
    ];
    if (range?.from) {
      filters.push(
        gte(schema.practiceChecklistCompletions.completedOn, range.from),
      );
    }
    if (range?.to) {
      filters.push(
        lte(schema.practiceChecklistCompletions.completedOn, range.to),
      );
    }
    const rows = await this.db
      .select()
      .from(schema.practiceChecklistCompletions)
      .where(and(...filters))
      .orderBy(schema.practiceChecklistCompletions.completedOn);
    return rows.map(mapPracticeChecklistCompletionRow);
  }

  async upsertPracticeChecklistCompletion(
    scope: TenantScope,
    input: PracticeChecklistCompletionWrite,
  ): Promise<StoredPracticeChecklistCompletion> {
    const existing = await this.getPracticeChecklistCompletion(
      scope,
      input.itemId,
      input.completedOn,
    );
    const { orgId, practiceId } = requireTenantScope(scope);
    if (existing) {
      const [row] = await this.db
        .update(schema.practiceChecklistCompletions)
        .set({
          completed: input.completed,
          completedBy:
            input.completedBy === undefined
              ? existing.completedBy
              : input.completedBy,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.practiceChecklistCompletions.id, existing.id),
            eq(schema.practiceChecklistCompletions.orgId, orgId),
            eq(schema.practiceChecklistCompletions.practiceId, practiceId),
          ),
        )
        .returning();
      return mapPracticeChecklistCompletionRow(row);
    }
    const [row] = await this.db
      .insert(schema.practiceChecklistCompletions)
      .values({
        orgId,
        practiceId,
        itemId: input.itemId,
        completedOn: input.completedOn,
        completedBy: input.completedBy ?? null,
        completed: input.completed,
      })
      .returning();
    return mapPracticeChecklistCompletionRow(row);
  }

  async createChecklistTemplate(
    scope: TenantScope,
    input: ChecklistTemplateWrite,
  ): Promise<StoredChecklistTemplate> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.checklistTemplates)
      .values({
        orgId,
        practiceId,
        name: input.name,
        patientType: input.patientType,
        active: input.active ?? true,
      })
      .returning();
    return mapChecklistTemplateRow(row);
  }

  async getChecklistTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<StoredChecklistTemplate | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.checklistTemplates)
      .where(
        and(
          eq(schema.checklistTemplates.id, id),
          eq(schema.checklistTemplates.orgId, orgId),
          eq(schema.checklistTemplates.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapChecklistTemplateRow(row) : undefined;
  }

  async listChecklistTemplates(
    scope: TenantScope,
  ): Promise<StoredChecklistTemplate[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.checklistTemplates)
      .where(
        and(
          eq(schema.checklistTemplates.orgId, orgId),
          eq(schema.checklistTemplates.practiceId, practiceId),
        ),
      )
      .orderBy(schema.checklistTemplates.name);
    return rows.map(mapChecklistTemplateRow);
  }

  async updateChecklistTemplate(
    scope: TenantScope,
    id: string,
    input: ChecklistTemplatePatch,
  ): Promise<StoredChecklistTemplate | undefined> {
    const existing = await this.getChecklistTemplate(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.checklistTemplates)
      .set({
        name: input.name ?? existing.name,
        patientType: input.patientType ?? existing.patientType,
        active: input.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.checklistTemplates.id, id),
          eq(schema.checklistTemplates.orgId, orgId),
          eq(schema.checklistTemplates.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapChecklistTemplateRow(row) : undefined;
  }

  async deleteChecklistTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const assigned = await this.countPatientChecklistsForTemplate(scope, id);
    if (assigned > 0) return false;
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.checklistTemplates)
      .where(
        and(
          eq(schema.checklistTemplates.id, id),
          eq(schema.checklistTemplates.orgId, orgId),
          eq(schema.checklistTemplates.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.checklistTemplates.id });
    return deleted.length > 0;
  }

  async createChecklistTemplateTask(
    scope: TenantScope,
    input: ChecklistTemplateTaskWrite,
  ): Promise<StoredChecklistTemplateTask> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.checklistTemplateTasks)
      .values({
        orgId,
        practiceId,
        templateId: input.templateId,
        title: input.title,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return mapChecklistTemplateTaskRow(row);
  }

  async getChecklistTemplateTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredChecklistTemplateTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.checklistTemplateTasks)
      .where(
        and(
          eq(schema.checklistTemplateTasks.id, id),
          eq(schema.checklistTemplateTasks.orgId, orgId),
          eq(schema.checklistTemplateTasks.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapChecklistTemplateTaskRow(row) : undefined;
  }

  async listChecklistTemplateTasks(
    scope: TenantScope,
    templateId?: string,
  ): Promise<StoredChecklistTemplateTask[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.checklistTemplateTasks.orgId, orgId),
      eq(schema.checklistTemplateTasks.practiceId, practiceId),
    ];
    if (templateId) {
      filters.push(eq(schema.checklistTemplateTasks.templateId, templateId));
    }
    const rows = await this.db
      .select()
      .from(schema.checklistTemplateTasks)
      .where(and(...filters))
      .orderBy(
        schema.checklistTemplateTasks.sortOrder,
        schema.checklistTemplateTasks.title,
      );
    return rows.map(mapChecklistTemplateTaskRow);
  }

  async updateChecklistTemplateTask(
    scope: TenantScope,
    id: string,
    input: ChecklistTemplateTaskPatch,
  ): Promise<StoredChecklistTemplateTask | undefined> {
    const existing = await this.getChecklistTemplateTask(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.checklistTemplateTasks)
      .set({
        title: input.title ?? existing.title,
        description:
          input.description === undefined
            ? existing.description
            : input.description,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.checklistTemplateTasks.id, id),
          eq(schema.checklistTemplateTasks.orgId, orgId),
          eq(schema.checklistTemplateTasks.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapChecklistTemplateTaskRow(row) : undefined;
  }

  async deleteChecklistTemplateTask(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.checklistTemplateTasks)
      .where(
        and(
          eq(schema.checklistTemplateTasks.id, id),
          eq(schema.checklistTemplateTasks.orgId, orgId),
          eq(schema.checklistTemplateTasks.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.checklistTemplateTasks.id });
    return deleted.length > 0;
  }

  async createPatientChecklist(
    scope: TenantScope,
    input: PatientChecklistWrite,
  ): Promise<StoredPatientChecklist> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.patientChecklists)
      .values({
        orgId,
        practiceId,
        patientId: input.patientId,
        templateId: input.templateId ?? null,
        templateName: input.templateName,
        status: input.status ?? "not_started",
        notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
      })
      .returning();
    return this.revealPatientChecklist(row);
  }

  async getPatientChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatientChecklist | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.patientChecklists)
      .where(
        and(
          eq(schema.patientChecklists.id, id),
          eq(schema.patientChecklists.orgId, orgId),
          eq(schema.patientChecklists.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? this.revealPatientChecklist(row) : undefined;
  }

  async listPatientChecklists(
    scope: TenantScope,
    patientId?: string,
  ): Promise<StoredPatientChecklist[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.patientChecklists.orgId, orgId),
      eq(schema.patientChecklists.practiceId, practiceId),
    ];
    if (patientId) {
      filters.push(eq(schema.patientChecklists.patientId, patientId));
    }
    const rows = await this.db
      .select()
      .from(schema.patientChecklists)
      .where(and(...filters))
      .orderBy(desc(schema.patientChecklists.createdAt));
    return rows.map((row) => this.revealPatientChecklist(row));
  }

  async updatePatientChecklist(
    scope: TenantScope,
    id: string,
    input: PatientChecklistPatch,
  ): Promise<StoredPatientChecklist | undefined> {
    const existing = await this.getPatientChecklist(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.patientChecklists)
      .set({
        templateId:
          input.templateId === undefined ? existing.templateId : input.templateId,
        templateName: input.templateName ?? existing.templateName,
        status: input.status ?? existing.status,
        notes:
          input.notes === undefined
            ? undefined
            : encryptPhiString(input.notes, this.phiEncryptionKey),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.patientChecklists.id, id),
          eq(schema.patientChecklists.orgId, orgId),
          eq(schema.patientChecklists.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? this.revealPatientChecklist(row) : undefined;
  }

  async deletePatientChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.patientChecklists)
      .where(
        and(
          eq(schema.patientChecklists.id, id),
          eq(schema.patientChecklists.orgId, orgId),
          eq(schema.patientChecklists.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.patientChecklists.id });
    return deleted.length > 0;
  }

  async countPatientChecklistsForTemplate(
    scope: TenantScope,
    templateId: string,
  ): Promise<number> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.patientChecklists)
      .where(
        and(
          eq(schema.patientChecklists.templateId, templateId),
          eq(schema.patientChecklists.orgId, orgId),
          eq(schema.patientChecklists.practiceId, practiceId),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async createPatientChecklistTask(
    scope: TenantScope,
    input: PatientChecklistTaskWrite,
  ): Promise<StoredPatientChecklistTask> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.patientChecklistTasks)
      .values({
        orgId,
        practiceId,
        patientChecklistId: input.patientChecklistId,
        title: input.title,
        done: input.done ?? false,
        assigneeName: input.assigneeName ?? null,
        notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
        completedAt: input.completedAt ?? null,
      })
      .returning();
    return this.revealPatientChecklistTask(row);
  }

  async getPatientChecklistTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatientChecklistTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.patientChecklistTasks)
      .where(
        and(
          eq(schema.patientChecklistTasks.id, id),
          eq(schema.patientChecklistTasks.orgId, orgId),
          eq(schema.patientChecklistTasks.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? this.revealPatientChecklistTask(row) : undefined;
  }

  async listPatientChecklistTasks(
    scope: TenantScope,
    patientChecklistId?: string,
  ): Promise<StoredPatientChecklistTask[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.patientChecklistTasks.orgId, orgId),
      eq(schema.patientChecklistTasks.practiceId, practiceId),
    ];
    if (patientChecklistId) {
      filters.push(
        eq(schema.patientChecklistTasks.patientChecklistId, patientChecklistId),
      );
    }
    const rows = await this.db
      .select()
      .from(schema.patientChecklistTasks)
      .where(and(...filters))
      .orderBy(
        schema.patientChecklistTasks.patientChecklistId,
        schema.patientChecklistTasks.createdAt,
      );
    return rows.map((row) => this.revealPatientChecklistTask(row));
  }

  async updatePatientChecklistTask(
    scope: TenantScope,
    id: string,
    input: PatientChecklistTaskPatch,
  ): Promise<StoredPatientChecklistTask | undefined> {
    const existing = await this.getPatientChecklistTask(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.patientChecklistTasks)
      .set({
        title: input.title ?? existing.title,
        done: input.done ?? existing.done,
        assigneeName:
          input.assigneeName === undefined
            ? existing.assigneeName
            : input.assigneeName,
        notes:
          input.notes === undefined
            ? undefined
            : encryptPhiString(input.notes, this.phiEncryptionKey),
        completedAt:
          input.completedAt === undefined
            ? existing.completedAt
            : input.completedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.patientChecklistTasks.id, id),
          eq(schema.patientChecklistTasks.orgId, orgId),
          eq(schema.patientChecklistTasks.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? this.revealPatientChecklistTask(row) : undefined;
  }

  async deletePatientChecklistTask(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.patientChecklistTasks)
      .where(
        and(
          eq(schema.patientChecklistTasks.id, id),
          eq(schema.patientChecklistTasks.orgId, orgId),
          eq(schema.patientChecklistTasks.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.patientChecklistTasks.id });
    return deleted.length > 0;
  }

  async getPracticeSettings(
    scope: TenantScope,
  ): Promise<StoredPracticeSettings | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.practiceSettings)
      .where(
        and(
          eq(schema.practiceSettings.orgId, orgId),
          eq(schema.practiceSettings.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapPracticeSettingsRow(row) : undefined;
  }

  async upsertPracticeSettings(
    scope: TenantScope,
    input: PracticeSettingsPatch,
  ): Promise<StoredPracticeSettings> {
    const existing = await this.getPracticeSettings(scope);
    const { orgId, practiceId } = requireTenantScope(scope);
    if (existing) {
      const [row] = await this.db
        .update(schema.practiceSettings)
        .set({
          carePlanTerms:
            input.carePlanTerms === undefined
              ? existing.carePlanTerms
              : input.carePlanTerms,
          complianceNotice:
            input.complianceNotice === undefined
              ? existing.complianceNotice
              : input.complianceNotice,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.practiceSettings.id, existing.id),
            eq(schema.practiceSettings.orgId, orgId),
            eq(schema.practiceSettings.practiceId, practiceId),
          ),
        )
        .returning();
      return row ? mapPracticeSettingsRow(row) : existing;
    }
    const [row] = await this.db
      .insert(schema.practiceSettings)
      .values({
        orgId,
        practiceId,
        carePlanTerms: input.carePlanTerms ?? null,
        complianceNotice: input.complianceNotice ?? null,
      })
      .returning();
    return mapPracticeSettingsRow(row);
  }

  async getCarePlanComplianceAck(
    scope: TenantScope,
    userId: string,
  ): Promise<StoredCarePlanComplianceAck | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.carePlanComplianceAcks)
      .where(
        and(
          eq(schema.carePlanComplianceAcks.orgId, orgId),
          eq(schema.carePlanComplianceAcks.practiceId, practiceId),
          eq(schema.carePlanComplianceAcks.userId, userId),
        ),
      )
      .limit(1);
    return row ? mapCarePlanComplianceAckRow(row) : undefined;
  }

  async upsertCarePlanComplianceAck(
    scope: TenantScope,
    userId: string,
    acknowledgedAt: Date,
  ): Promise<StoredCarePlanComplianceAck> {
    const existing = await this.getCarePlanComplianceAck(scope, userId);
    const { orgId, practiceId } = requireTenantScope(scope);
    if (existing) {
      const [row] = await this.db
        .update(schema.carePlanComplianceAcks)
        .set({ acknowledgedAt })
        .where(
          and(
            eq(schema.carePlanComplianceAcks.id, existing.id),
            eq(schema.carePlanComplianceAcks.orgId, orgId),
            eq(schema.carePlanComplianceAcks.practiceId, practiceId),
          ),
        )
        .returning();
      return row ? mapCarePlanComplianceAckRow(row) : { ...existing, acknowledgedAt };
    }
    const [row] = await this.db
      .insert(schema.carePlanComplianceAcks)
      .values({ orgId, practiceId, userId, acknowledgedAt })
      .returning();
    return mapCarePlanComplianceAckRow(row);
  }

  async createCarePlanTemplate(
    scope: TenantScope,
    input: CarePlanTemplateWrite,
  ): Promise<StoredCarePlanTemplate> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.carePlanTemplates)
      .values({
        orgId,
        practiceId,
        name: input.name,
        defaultSelections: input.defaultSelections,
        active: input.active ?? true,
      })
      .returning();
    return mapCarePlanTemplateRow(row);
  }

  async getCarePlanTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<StoredCarePlanTemplate | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.carePlanTemplates)
      .where(
        and(
          eq(schema.carePlanTemplates.id, id),
          eq(schema.carePlanTemplates.orgId, orgId),
          eq(schema.carePlanTemplates.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapCarePlanTemplateRow(row) : undefined;
  }

  async listCarePlanTemplates(
    scope: TenantScope,
  ): Promise<StoredCarePlanTemplate[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.carePlanTemplates)
      .where(
        and(
          eq(schema.carePlanTemplates.orgId, orgId),
          eq(schema.carePlanTemplates.practiceId, practiceId),
        ),
      )
      .orderBy(desc(schema.carePlanTemplates.createdAt));
    return rows.map(mapCarePlanTemplateRow);
  }

  async updateCarePlanTemplate(
    scope: TenantScope,
    id: string,
    input: CarePlanTemplatePatch,
  ): Promise<StoredCarePlanTemplate | undefined> {
    const existing = await this.getCarePlanTemplate(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.carePlanTemplates)
      .set({
        name: input.name ?? existing.name,
        defaultSelections: input.defaultSelections ?? existing.defaultSelections,
        active: input.active ?? existing.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.carePlanTemplates.id, id),
          eq(schema.carePlanTemplates.orgId, orgId),
          eq(schema.carePlanTemplates.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapCarePlanTemplateRow(row) : undefined;
  }

  async deleteCarePlanTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.carePlanTemplates)
      .where(
        and(
          eq(schema.carePlanTemplates.id, id),
          eq(schema.carePlanTemplates.orgId, orgId),
          eq(schema.carePlanTemplates.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.carePlanTemplates.id });
    return deleted.length > 0;
  }

  async createCarePlan(
    scope: TenantScope,
    input: CarePlanWrite,
  ): Promise<StoredCarePlan> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const enc = encryptCarePlanSensitiveFields(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        notes: input.notes ?? null,
      },
      this.phiEncryptionKey,
    );
    const [row] = await this.db
      .insert(schema.carePlans)
      .values({
        orgId,
        practiceId,
        patientId: input.patientId ?? null,
        firstNameEnc: enc.firstName ?? "",
        lastNameEnc: enc.lastName ?? "",
        notesEnc: enc.notes ?? null,
        treatmentSelections: input.treatmentSelections,
        paymentSettings: input.paymentSettings,
        subtotalCents: input.subtotalCents,
        status: input.status ?? "draft",
        complianceAcknowledgedAt: input.complianceAcknowledgedAt ?? null,
        complianceAcknowledgedBy: input.complianceAcknowledgedBy ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return this.revealCarePlan(row);
  }

  async getCarePlan(
    scope: TenantScope,
    id: string,
  ): Promise<StoredCarePlan | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.carePlans)
      .where(
        and(
          eq(schema.carePlans.id, id),
          eq(schema.carePlans.orgId, orgId),
          eq(schema.carePlans.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? this.revealCarePlan(row) : undefined;
  }

  async listCarePlans(scope: TenantScope): Promise<StoredCarePlan[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.carePlans)
      .where(
        and(
          eq(schema.carePlans.orgId, orgId),
          eq(schema.carePlans.practiceId, practiceId),
        ),
      )
      .orderBy(desc(schema.carePlans.createdAt));
    return rows.map((row) => this.revealCarePlan(row));
  }

  async updateCarePlan(
    scope: TenantScope,
    id: string,
    input: CarePlanPatch,
  ): Promise<StoredCarePlan | undefined> {
    const existing = await this.getCarePlan(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const enc = encryptCarePlanSensitiveFields(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        notes: input.notes,
      },
      this.phiEncryptionKey,
    );
    const [row] = await this.db
      .update(schema.carePlans)
      .set({
        patientId:
          input.patientId === undefined ? existing.patientId : input.patientId,
        firstNameEnc:
          input.firstName === undefined ? undefined : (enc.firstName ?? ""),
        lastNameEnc:
          input.lastName === undefined ? undefined : (enc.lastName ?? ""),
        notesEnc: input.notes === undefined ? undefined : enc.notes,
        treatmentSelections:
          input.treatmentSelections ?? existing.treatmentSelections,
        paymentSettings: input.paymentSettings ?? existing.paymentSettings,
        subtotalCents: input.subtotalCents ?? existing.subtotalCents,
        status: input.status ?? existing.status,
        complianceAcknowledgedAt:
          input.complianceAcknowledgedAt === undefined
            ? existing.complianceAcknowledgedAt
            : input.complianceAcknowledgedAt,
        complianceAcknowledgedBy:
          input.complianceAcknowledgedBy === undefined
            ? existing.complianceAcknowledgedBy
            : input.complianceAcknowledgedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.carePlans.id, id),
          eq(schema.carePlans.orgId, orgId),
          eq(schema.carePlans.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? this.revealCarePlan(row) : undefined;
  }

  async deleteCarePlan(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.carePlans)
      .where(
        and(
          eq(schema.carePlans.id, id),
          eq(schema.carePlans.orgId, orgId),
          eq(schema.carePlans.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.carePlans.id });
    return deleted.length > 0;
  }

  async createProject(
    scope: TenantScope,
    input: ProjectWrite,
  ): Promise<StoredProject> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.projects)
      .values({
        orgId,
        practiceId,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? "active",
        tags: input.tags ?? [],
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return mapProjectRow(row);
  }

  async getProject(
    scope: TenantScope,
    id: string,
  ): Promise<StoredProject | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.orgId, orgId),
          eq(schema.projects.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapProjectRow(row) : undefined;
  }

  async listProjects(
    scope: TenantScope,
    status?: string,
  ): Promise<StoredProject[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.projects.orgId, orgId),
      eq(schema.projects.practiceId, practiceId),
    ];
    if (status) filters.push(eq(schema.projects.status, status));
    const rows = await this.db
      .select()
      .from(schema.projects)
      .where(and(...filters))
      .orderBy(desc(schema.projects.updatedAt));
    return rows.map(mapProjectRow);
  }

  async updateProject(
    scope: TenantScope,
    id: string,
    input: ProjectPatch,
  ): Promise<StoredProject | undefined> {
    const existing = await this.getProject(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.projects)
      .set({
        name: input.name ?? existing.name,
        description:
          input.description === undefined
            ? existing.description
            : input.description,
        status: input.status ?? existing.status,
        tags: input.tags ?? existing.tags,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.orgId, orgId),
          eq(schema.projects.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapProjectRow(row) : undefined;
  }

  async deleteProject(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.projects)
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.orgId, orgId),
          eq(schema.projects.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.projects.id });
    return deleted.length > 0;
  }

  async createProjectColumn(
    scope: TenantScope,
    input: ProjectColumnWrite,
  ): Promise<StoredProjectColumn> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.projectColumns)
      .values({
        orgId,
        practiceId,
        projectId: input.projectId,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return mapProjectColumnRow(row);
  }

  async getProjectColumn(
    scope: TenantScope,
    id: string,
  ): Promise<StoredProjectColumn | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.projectColumns)
      .where(
        and(
          eq(schema.projectColumns.id, id),
          eq(schema.projectColumns.orgId, orgId),
          eq(schema.projectColumns.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapProjectColumnRow(row) : undefined;
  }

  async listProjectColumns(
    scope: TenantScope,
    projectId?: string,
  ): Promise<StoredProjectColumn[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.projectColumns.orgId, orgId),
      eq(schema.projectColumns.practiceId, practiceId),
    ];
    if (projectId) {
      filters.push(eq(schema.projectColumns.projectId, projectId));
    }
    const rows = await this.db
      .select()
      .from(schema.projectColumns)
      .where(and(...filters))
      .orderBy(
        schema.projectColumns.projectId,
        schema.projectColumns.sortOrder,
        schema.projectColumns.name,
      );
    return rows.map(mapProjectColumnRow);
  }

  async updateProjectColumn(
    scope: TenantScope,
    id: string,
    input: ProjectColumnPatch,
  ): Promise<StoredProjectColumn | undefined> {
    const existing = await this.getProjectColumn(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.projectColumns)
      .set({
        name: input.name ?? existing.name,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.projectColumns.id, id),
          eq(schema.projectColumns.orgId, orgId),
          eq(schema.projectColumns.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapProjectColumnRow(row) : undefined;
  }

  async deleteProjectColumn(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.projectColumns)
      .where(
        and(
          eq(schema.projectColumns.id, id),
          eq(schema.projectColumns.orgId, orgId),
          eq(schema.projectColumns.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.projectColumns.id });
    return deleted.length > 0;
  }

  async countProjectTasksInColumn(
    scope: TenantScope,
    columnId: string,
  ): Promise<number> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.projectTasks)
      .where(
        and(
          eq(schema.projectTasks.columnId, columnId),
          eq(schema.projectTasks.orgId, orgId),
          eq(schema.projectTasks.practiceId, practiceId),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async createProjectTask(
    scope: TenantScope,
    input: ProjectTaskWrite,
  ): Promise<StoredProjectTask> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.projectTasks)
      .values({
        orgId,
        practiceId,
        projectId: input.projectId,
        columnId: input.columnId,
        title: input.title,
        notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
        sortOrder: input.sortOrder ?? 0,
        done: input.done ?? false,
        dueDate: input.dueDate ?? null,
        assigneeName: input.assigneeName ?? null,
      })
      .returning();
    return this.revealProjectTask(row);
  }

  async getProjectTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredProjectTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.projectTasks)
      .where(
        and(
          eq(schema.projectTasks.id, id),
          eq(schema.projectTasks.orgId, orgId),
          eq(schema.projectTasks.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? this.revealProjectTask(row) : undefined;
  }

  async listProjectTasks(
    scope: TenantScope,
    projectId?: string,
  ): Promise<StoredProjectTask[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.projectTasks.orgId, orgId),
      eq(schema.projectTasks.practiceId, practiceId),
    ];
    if (projectId) {
      filters.push(eq(schema.projectTasks.projectId, projectId));
    }
    const rows = await this.db
      .select()
      .from(schema.projectTasks)
      .where(and(...filters))
      .orderBy(
        schema.projectTasks.projectId,
        schema.projectTasks.sortOrder,
        schema.projectTasks.createdAt,
      );
    return rows.map((row) => this.revealProjectTask(row));
  }

  async updateProjectTask(
    scope: TenantScope,
    id: string,
    input: ProjectTaskPatch,
  ): Promise<StoredProjectTask | undefined> {
    const existing = await this.getProjectTask(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.projectTasks)
      .set({
        columnId: input.columnId ?? existing.columnId,
        title: input.title ?? existing.title,
        notes:
          input.notes === undefined
            ? undefined
            : encryptPhiString(input.notes, this.phiEncryptionKey),
        sortOrder: input.sortOrder ?? existing.sortOrder,
        done: input.done ?? existing.done,
        dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
        assigneeName:
          input.assigneeName === undefined
            ? existing.assigneeName
            : input.assigneeName,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.projectTasks.id, id),
          eq(schema.projectTasks.orgId, orgId),
          eq(schema.projectTasks.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? this.revealProjectTask(row) : undefined;
  }

  async deleteProjectTask(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const deleted = await this.db
      .delete(schema.projectTasks)
      .where(
        and(
          eq(schema.projectTasks.id, id),
          eq(schema.projectTasks.orgId, orgId),
          eq(schema.projectTasks.practiceId, practiceId),
        ),
      )
      .returning({ id: schema.projectTasks.id });
    return deleted.length > 0;
  }

  async listAdvancedMetricInputs(
    scope: TenantScope,
    periodMonth?: string,
  ): Promise<StoredAdvancedMetricInput[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = [
      eq(schema.advancedMetricsInputs.orgId, orgId),
      eq(schema.advancedMetricsInputs.practiceId, practiceId),
    ];
    if (periodMonth) {
      filters.push(eq(schema.advancedMetricsInputs.periodMonth, periodMonth));
    }
    const rows = await this.db
      .select()
      .from(schema.advancedMetricsInputs)
      .where(and(...filters));
    return rows.map(mapAdvancedMetricInputRow);
  }

  async upsertAdvancedMetricInput(
    scope: TenantScope,
    input: AdvancedMetricInputWrite,
  ): Promise<StoredAdvancedMetricInput> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [existing] = await this.db
      .select()
      .from(schema.advancedMetricsInputs)
      .where(
        and(
          eq(schema.advancedMetricsInputs.orgId, orgId),
          eq(schema.advancedMetricsInputs.practiceId, practiceId),
          eq(schema.advancedMetricsInputs.periodMonth, input.periodMonth),
          eq(schema.advancedMetricsInputs.section, input.section),
          eq(schema.advancedMetricsInputs.key, input.key),
        ),
      )
      .limit(1);
    if (existing) {
      const [row] = await this.db
        .update(schema.advancedMetricsInputs)
        .set({
          valueNumeric:
            input.valueNumeric === undefined
              ? existing.valueNumeric
              : input.valueNumeric,
          valueText:
            input.valueText === undefined ? existing.valueText : input.valueText,
          source: input.source ?? existing.source,
          updatedBy:
            input.updatedBy === undefined ? existing.updatedBy : input.updatedBy,
          updatedAt: new Date(),
        })
        .where(eq(schema.advancedMetricsInputs.id, existing.id))
        .returning();
      return mapAdvancedMetricInputRow(row);
    }
    const [row] = await this.db
      .insert(schema.advancedMetricsInputs)
      .values({
        orgId,
        practiceId,
        periodMonth: input.periodMonth,
        section: input.section,
        key: input.key,
        valueNumeric: input.valueNumeric ?? null,
        valueText: input.valueText ?? null,
        source: input.source ?? "manual",
        updatedBy: input.updatedBy ?? null,
      })
      .returning();
    return mapAdvancedMetricInputRow(row);
  }

  async createImportBatch(
    scope: TenantScope,
    input: ImportBatchWrite,
  ): Promise<StoredImportBatch> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.importBatches)
      .values({
        orgId,
        practiceId,
        fileName: input.fileName,
        fileType: input.fileType,
        status: input.status ?? "uploaded",
        totalRows: input.totalRows ?? 0,
        columnMapping: input.columnMapping ?? null,
        headers: input.headers ?? null,
        importType: input.importType ?? "daily_log",
        createdBy: input.createdBy ?? null,
        rawExpiresAt: input.rawExpiresAt,
      })
      .returning();
    return mapImportBatchRow(row);
  }

  async getImportBatch(
    scope: TenantScope,
    id: string,
  ): Promise<StoredImportBatch | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select()
      .from(schema.importBatches)
      .where(
        and(
          eq(schema.importBatches.id, id),
          eq(schema.importBatches.orgId, orgId),
          eq(schema.importBatches.practiceId, practiceId),
        ),
      )
      .limit(1);
    return row ? mapImportBatchRow(row) : undefined;
  }

  async listImportBatches(scope: TenantScope): Promise<StoredImportBatch[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.importBatches)
      .where(
        and(
          eq(schema.importBatches.orgId, orgId),
          eq(schema.importBatches.practiceId, practiceId),
        ),
      )
      .orderBy(desc(schema.importBatches.createdAt));
    return rows.map(mapImportBatchRow);
  }

  async updateImportBatch(
    scope: TenantScope,
    id: string,
    input: ImportBatchPatch,
  ): Promise<StoredImportBatch | undefined> {
    const existing = await this.getImportBatch(scope, id);
    if (!existing) return undefined;
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .update(schema.importBatches)
      .set({
        status: input.status ?? existing.status,
        totalRows: input.totalRows ?? existing.totalRows,
        successRows: input.successRows ?? existing.successRows,
        errorRows: input.errorRows ?? existing.errorRows,
        skippedRows: input.skippedRows ?? existing.skippedRows,
        columnMapping:
          input.columnMapping === undefined
            ? existing.columnMapping
            : input.columnMapping,
        headers: input.headers === undefined ? existing.headers : input.headers,
        importType: input.importType ?? existing.importType,
        errorSummary:
          input.errorSummary === undefined
            ? existing.errorSummary
            : input.errorSummary,
        committedAt:
          input.committedAt === undefined
            ? existing.committedAt
            : input.committedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.importBatches.id, id),
          eq(schema.importBatches.orgId, orgId),
          eq(schema.importBatches.practiceId, practiceId),
        ),
      )
      .returning();
    return row ? mapImportBatchRow(row) : undefined;
  }

  async createImportRow(
    scope: TenantScope,
    input: ImportRowWrite,
  ): Promise<StoredImportRow> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .insert(schema.importRows)
      .values({
        orgId,
        practiceId,
        batchId: input.batchId,
        rowNumber: input.rowNumber,
        rawData:
          encryptPhiStringIfKeyed(input.rawData, this.phiEncryptionKey) ?? "",
        normalizedData: encryptPhiStringIfKeyed(
          input.normalizedData ?? null,
          this.phiEncryptionKey,
        ),
        status: input.status ?? "pending",
        errorMessage: input.errorMessage ?? null,
        targetEntityType: input.targetEntityType ?? null,
        targetEntityId: input.targetEntityId ?? null,
        contentHash: input.contentHash ?? null,
      })
      .returning();
    return decryptStoredImportRow(mapImportRow(row), this.phiEncryptionKey);
  }

  async listImportRows(
    scope: TenantScope,
    batchId: string,
  ): Promise<StoredImportRow[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.importRows)
      .where(
        and(
          eq(schema.importRows.orgId, orgId),
          eq(schema.importRows.practiceId, practiceId),
          eq(schema.importRows.batchId, batchId),
        ),
      )
      .orderBy(asc(schema.importRows.rowNumber));
    return rows.map((row) =>
      decryptStoredImportRow(mapImportRow(row), this.phiEncryptionKey),
    );
  }

  async updateImportRow(
    scope: TenantScope,
    id: string,
    input: ImportRowPatch,
  ): Promise<StoredImportRow | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [existing] = await this.db
      .select()
      .from(schema.importRows)
      .where(
        and(
          eq(schema.importRows.id, id),
          eq(schema.importRows.orgId, orgId),
          eq(schema.importRows.practiceId, practiceId),
        ),
      )
      .limit(1);
    if (!existing) return undefined;
    const [row] = await this.db
      .update(schema.importRows)
      .set({
        normalizedData:
          input.normalizedData === undefined
            ? existing.normalizedData
            : encryptPhiStringIfKeyed(input.normalizedData, this.phiEncryptionKey),
        status: input.status ?? existing.status,
        errorMessage:
          input.errorMessage === undefined
            ? existing.errorMessage
            : input.errorMessage,
        targetEntityType:
          input.targetEntityType === undefined
            ? existing.targetEntityType
            : input.targetEntityType,
        targetEntityId:
          input.targetEntityId === undefined
            ? existing.targetEntityId
            : input.targetEntityId,
        rawData:
          input.rawData === undefined
            ? existing.rawData
            : encryptPhiStringIfKeyed(input.rawData, this.phiEncryptionKey) ?? "",
        updatedAt: new Date(),
      })
      .where(eq(schema.importRows.id, existing.id))
      .returning();
    return row
      ? decryptStoredImportRow(mapImportRow(row), this.phiEncryptionKey)
      : undefined;
  }

  async pruneExpiredImportRawRows(nowDate: Date): Promise<number> {
    const expired = await this.db
      .select({ id: schema.importBatches.id })
      .from(schema.importBatches)
      .where(lte(schema.importBatches.rawExpiresAt, nowDate));
    if (expired.length === 0) return 0;
    let cleared = 0;
    for (const batch of expired) {
      const updated = await this.db
        .update(schema.importRows)
        .set({
          rawData: "",
          normalizedData: null,
          updatedAt: nowDate,
        })
        .where(eq(schema.importRows.batchId, batch.id))
        .returning({ id: schema.importRows.id });
      cleared += updated.length;
    }
    return cleared;
  }

  async createAuditLog(input: NewAuditLog): Promise<StoredAuditLog> {
    const scope = requireTenantScope({
      orgId: input.orgId,
      practiceId: input.practiceId,
    });
    const [row] = await this.db
      .insert(schema.auditLogs)
      .values({
        orgId: scope.orgId,
        practiceId: scope.practiceId,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
      })
      .returning();
    return {
      id: row.id,
      orgId: row.orgId,
      practiceId: row.practiceId,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    };
  }

  async listAuditLogs(
    scope: TenantScope,
    query?: AuditLogQuery,
  ): Promise<StoredAuditLog[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const filters = and(
      eq(schema.auditLogs.orgId, orgId),
      eq(schema.auditLogs.practiceId, practiceId),
    );
    const base = this.db
      .select()
      .from(schema.auditLogs)
      .where(filters)
      .orderBy(desc(schema.auditLogs.createdAt));
    const rows =
      query?.limit != null
        ? await base.limit(query.limit).offset(query.offset ?? 0)
        : query?.offset
          ? await base.offset(query.offset)
          : await base;
    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      practiceId: row.practiceId,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    }));
  }

  async countAuditLogs(scope: TenantScope): Promise<number> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const [row] = await this.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.orgId, orgId),
          eq(schema.auditLogs.practiceId, practiceId),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredPasswordResetToken> {
    const [row] = await this.db
      .insert(schema.passwordResetTokens)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      })
      .returning();
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    };
  }

  async getPasswordResetTokenByHash(
    tokenHash: string,
  ): Promise<StoredPasswordResetToken | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, tokenHash))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    };
  }

  async markPasswordResetTokenUsed(id: string, usedAt: Date): Promise<void> {
    await this.db
      .update(schema.passwordResetTokens)
      .set({ usedAt })
      .where(eq(schema.passwordResetTokens.id, id));
  }

  async invalidatePasswordResetTokensForUser(
    userId: string,
    usedAt: Date,
  ): Promise<void> {
    await this.db
      .update(schema.passwordResetTokens)
      .set({ usedAt })
      .where(
        and(
          eq(schema.passwordResetTokens.userId, userId),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      );
  }

  async createInvitation(input: {
    email: string;
    orgId: string;
    practiceId: string;
    role: MembershipRole;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string;
  }): Promise<StoredInvitation> {
    requireTenantScope({ orgId: input.orgId, practiceId: input.practiceId });
    const [row] = await this.db
      .insert(schema.teamInvitations)
      .values({
        email: input.email,
        orgId: input.orgId,
        practiceId: input.practiceId,
        role: input.role,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        invitedBy: input.invitedBy,
      })
      .returning();
    return mapInvitation(row);
  }

  async getInvitationById(id: string): Promise<StoredInvitation | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.teamInvitations)
      .where(eq(schema.teamInvitations.id, id))
      .limit(1);
    return row ? mapInvitation(row) : undefined;
  }

  async getInvitationByTokenHash(
    tokenHash: string,
  ): Promise<StoredInvitation | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.teamInvitations)
      .where(eq(schema.teamInvitations.tokenHash, tokenHash))
      .limit(1);
    return row ? mapInvitation(row) : undefined;
  }

  async listPendingInvitationsForPractice(
    scope: TenantScope,
    nowDate: Date,
  ): Promise<StoredInvitation[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.teamInvitations)
      .where(
        and(
          eq(schema.teamInvitations.orgId, orgId),
          eq(schema.teamInvitations.practiceId, practiceId),
          isNull(schema.teamInvitations.acceptedAt),
          isNull(schema.teamInvitations.revokedAt),
          gt(schema.teamInvitations.expiresAt, nowDate),
        ),
      );
    return rows.map(mapInvitation);
  }

  async getPendingInvitationByEmail(
    practiceId: string,
    email: string,
    nowDate: Date,
  ): Promise<StoredInvitation | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.teamInvitations)
      .where(
        and(
          eq(schema.teamInvitations.practiceId, practiceId),
          eq(schema.teamInvitations.email, email),
          isNull(schema.teamInvitations.acceptedAt),
          isNull(schema.teamInvitations.revokedAt),
          gt(schema.teamInvitations.expiresAt, nowDate),
        ),
      )
      .limit(1);
    if (!row) return undefined;
    const mapped = mapInvitation(row);
    return isPendingInvitation(mapped, nowDate) ? mapped : undefined;
  }

  async markInvitationAccepted(
    id: string,
    acceptedAt: Date,
    acceptedByUserId: string,
  ): Promise<void> {
    await this.db
      .update(schema.teamInvitations)
      .set({ acceptedAt, acceptedByUserId })
      .where(eq(schema.teamInvitations.id, id));
  }

  async revokeInvitation(
    id: string,
    revokedAt: Date,
  ): Promise<StoredInvitation | undefined> {
    const existing = await this.getInvitationById(id);
    if (!existing || existing.acceptedAt || existing.revokedAt) return undefined;
    const [row] = await this.db
      .update(schema.teamInvitations)
      .set({ revokedAt })
      .where(
        and(
          eq(schema.teamInvitations.id, id),
          isNull(schema.teamInvitations.acceptedAt),
          isNull(schema.teamInvitations.revokedAt),
        ),
      )
      .returning();
    return row ? mapInvitation(row) : undefined;
  }
}
