import type { SubscriptionStatus } from "@shared/billing";
import type {
  CarePlanPaymentSettings,
  CarePlanStatus,
  CarePlanTemplateSelections,
  CarePlanTreatmentSelection,
} from "@shared/care-plans";
import type { MembershipRole } from "@shared/roles";
import type { TenantScope } from "../tenant/scope";
import type { AuditLogQuery } from "./audit-query";

export type StoredUser = {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
  status: "active" | "suspended" | "disabled";
  mfaEnabled: boolean;
  mfaMethod: string | null;
  mfaSecretEnc: string | null;
  mfaPendingSecretEnc: string | null;
  mfaRecoveryCodesHash: string | null;
  mfaEnrolledAt: Date | null;
  credentialsChangedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type UserPatch = Partial<{
  passwordHash: string;
  displayName: string;
  status: StoredUser["status"];
  mfaEnabled: boolean;
  mfaMethod: string | null;
  mfaSecretEnc: string | null;
  mfaPendingSecretEnc: string | null;
  mfaRecoveryCodesHash: string | null;
  mfaEnrolledAt: Date | null;
  credentialsChangedAt: Date | null;
}>;

export type StoredOrganization = {
  id: string;
  name: string;
  status: "active" | "suspended" | "disabled";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string | null;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  createdAt: Date;
};

export type OrganizationPatch = Partial<{
  name: string;
  status: StoredOrganization["status"];
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string | null;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
}>;

export type StoredPractice = {
  id: string;
  orgId: string;
  name: string;
  status: "active" | "suspended" | "disabled";
  logoUrl?: string | null;
  primaryColor?: string | null;
  createdAt: Date;
};

export type StoredOrgMembership = {
  id: string;
  orgId: string;
  userId: string;
  role: MembershipRole;
  status: "active" | "invited" | "revoked";
};

export type StoredPracticeMembership = {
  id: string;
  orgId: string;
  practiceId: string;
  userId: string;
  role: MembershipRole;
  status: "active" | "invited" | "revoked";
};

export type StoredPatient = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  condition: string | null;
  status: string;
  patientType: string;
  typeName: string | null;
  referralSourceId: string | null;
  referralSource: string | null;
  day1Date: string | null;
  day2Date: string | null;
  careStatus: string;
  converted: boolean;
  conversionDate: string | null;
  planType: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PatientWrite = {
  name: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  condition?: string | null;
  status?: string;
  patientType?: string;
  typeName?: string | null;
  referralSourceId?: string | null;
  referralSource?: string | null;
  day1Date?: string | null;
  day2Date?: string | null;
  careStatus?: string;
  converted?: boolean;
  conversionDate?: string | null;
  planType?: string | null;
  notes?: string | null;
  createdBy?: string | null;
};

export type StoredReferralSource = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredDailyStat = {
  id: string;
  orgId: string;
  practiceId: string;
  date: string;
  visits: number;
  revenueCents: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DailyStatWrite = {
  date: string;
  visits: number;
  revenueCents: number;
  notes?: string | null;
  createdBy?: string | null;
};

export type DailyStatPatch = Partial<{
  visits: number;
  revenueCents: number;
  notes: string | null;
}>;

export type DailyStatRange = {
  from?: string;
  to?: string;
};

export type StoredGoal = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  metricType: string;
  targetValue: number;
  currentValue: number | null;
  timePeriod: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GoalWrite = {
  name: string;
  metricType: string;
  targetValue: number;
  currentValue?: number | null;
  timePeriod?: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
  createdBy?: string | null;
};

export type GoalPatch = Partial<{
  name: string;
  metricType: string;
  targetValue: number;
  currentValue: number | null;
  timePeriod: string;
  startDate: string;
  endDate: string;
  notes: string | null;
}>;

export type StoredTreatment = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  description: string | null;
  category: string;
  priceCents: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TreatmentWrite = {
  name: string;
  description?: string | null;
  category: string;
  priceCents: number;
  active?: boolean;
  sortOrder?: number;
};

export type TreatmentPatch = Partial<{
  name: string;
  description: string | null;
  category: string;
  priceCents: number;
  active: boolean;
  sortOrder: number;
}>;

export type StoredPracticeSettings = {
  id: string;
  orgId: string;
  practiceId: string;
  carePlanTerms: string | null;
  complianceNotice: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PracticeSettingsPatch = Partial<{
  carePlanTerms: string | null;
  complianceNotice: string | null;
}>;

export type StoredCarePlanComplianceAck = {
  id: string;
  orgId: string;
  practiceId: string;
  userId: string;
  acknowledgedAt: Date;
};

export type StoredCarePlanTemplate = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  defaultSelections: CarePlanTemplateSelections;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CarePlanTemplateWrite = {
  name: string;
  defaultSelections: CarePlanTemplateSelections;
  active?: boolean;
};

export type CarePlanTemplatePatch = Partial<{
  name: string;
  defaultSelections: CarePlanTemplateSelections;
  active: boolean;
}>;

/**
 * Callers of the storage layer always see plaintext first/last name and notes.
 * Columns `first_name_enc` / `last_name_enc` / `notes_enc` hold ciphertext.
 */
export type StoredCarePlan = {
  id: string;
  orgId: string;
  practiceId: string;
  patientId: string | null;
  firstName: string;
  lastName: string;
  notes: string | null;
  treatmentSelections: CarePlanTreatmentSelection[];
  paymentSettings: CarePlanPaymentSettings;
  subtotalCents: number;
  status: CarePlanStatus;
  complianceAcknowledgedAt: Date | null;
  complianceAcknowledgedBy: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CarePlanWrite = {
  patientId?: string | null;
  firstName: string;
  lastName: string;
  notes?: string | null;
  treatmentSelections: CarePlanTreatmentSelection[];
  paymentSettings: CarePlanPaymentSettings;
  subtotalCents: number;
  status?: CarePlanStatus;
  complianceAcknowledgedAt?: Date | null;
  complianceAcknowledgedBy?: string | null;
  createdBy?: string | null;
};

export type CarePlanPatch = Partial<{
  patientId: string | null;
  firstName: string;
  lastName: string;
  notes: string | null;
  treatmentSelections: CarePlanTreatmentSelection[];
  paymentSettings: CarePlanPaymentSettings;
  subtotalCents: number;
  status: CarePlanStatus;
  complianceAcknowledgedAt: Date | null;
  complianceAcknowledgedBy: string | null;
}>;

export type StoredPracticeChecklist = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  cadence: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PracticeChecklistWrite = {
  name: string;
  cadence: string;
  active?: boolean;
};

export type PracticeChecklistPatch = Partial<{
  name: string;
  cadence: string;
  active: boolean;
}>;

export type StoredPracticeChecklistItem = {
  id: string;
  orgId: string;
  practiceId: string;
  checklistId: string;
  title: string;
  category: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PracticeChecklistItemWrite = {
  checklistId: string;
  title: string;
  category: string;
  sortOrder?: number;
  active?: boolean;
};

export type PracticeChecklistItemPatch = Partial<{
  title: string;
  category: string;
  sortOrder: number;
  active: boolean;
}>;

export type StoredPracticeChecklistCompletion = {
  id: string;
  orgId: string;
  practiceId: string;
  itemId: string;
  completedOn: string;
  completedBy: string | null;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PracticeChecklistCompletionWrite = {
  itemId: string;
  completedOn: string;
  completed: boolean;
  completedBy?: string | null;
};

export type StoredChecklistTemplate = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  patientType: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ChecklistTemplateWrite = {
  name: string;
  patientType: string;
  active?: boolean;
};

export type ChecklistTemplatePatch = Partial<{
  name: string;
  patientType: string;
  active: boolean;
}>;

export type StoredChecklistTemplateTask = {
  id: string;
  orgId: string;
  practiceId: string;
  templateId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ChecklistTemplateTaskWrite = {
  templateId: string;
  title: string;
  description?: string | null;
  sortOrder?: number;
};

export type ChecklistTemplateTaskPatch = Partial<{
  title: string;
  description: string | null;
  sortOrder: number;
}>;

export type StoredPatientChecklist = {
  id: string;
  orgId: string;
  practiceId: string;
  patientId: string;
  templateId: string | null;
  templateName: string;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PatientChecklistWrite = {
  patientId: string;
  templateId?: string | null;
  templateName: string;
  status?: string;
  notes?: string | null;
};

export type PatientChecklistPatch = Partial<{
  templateId: string | null;
  templateName: string;
  status: string;
  notes: string | null;
}>;

export type StoredPatientChecklistTask = {
  id: string;
  orgId: string;
  practiceId: string;
  patientChecklistId: string;
  title: string;
  done: boolean;
  assigneeName: string | null;
  notes: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PatientChecklistTaskWrite = {
  patientChecklistId: string;
  title: string;
  done?: boolean;
  assigneeName?: string | null;
  notes?: string | null;
  completedAt?: Date | null;
};

export type PatientChecklistTaskPatch = Partial<{
  title: string;
  done: boolean;
  assigneeName: string | null;
  notes: string | null;
  completedAt: Date | null;
}>;

export type StoredProject = {
  id: string;
  orgId: string;
  practiceId: string;
  name: string;
  description: string | null;
  status: string;
  tags: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectWrite = {
  name: string;
  description?: string | null;
  status?: string;
  tags?: string[];
  createdBy?: string | null;
};

export type ProjectPatch = Partial<{
  name: string;
  description: string | null;
  status: string;
  tags: string[];
}>;

export type StoredProjectColumn = {
  id: string;
  orgId: string;
  practiceId: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectColumnWrite = {
  projectId: string;
  name: string;
  sortOrder?: number;
};

export type ProjectColumnPatch = Partial<{
  name: string;
  sortOrder: number;
}>;

/**
 * Callers of the storage layer always see plaintext notes.
 * The `notes` column holds ciphertext when PHI_ENCRYPTION_KEY is set.
 */
export type StoredProjectTask = {
  id: string;
  orgId: string;
  practiceId: string;
  projectId: string;
  columnId: string;
  title: string;
  notes: string | null;
  sortOrder: number;
  done: boolean;
  dueDate: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectTaskWrite = {
  projectId: string;
  columnId: string;
  title: string;
  notes?: string | null;
  sortOrder?: number;
  done?: boolean;
  dueDate?: string | null;
  assigneeName?: string | null;
};

export type ProjectTaskPatch = Partial<{
  columnId: string;
  title: string;
  notes: string | null;
  sortOrder: number;
  done: boolean;
  dueDate: string | null;
  assigneeName: string | null;
}>;

export type StoredAdvancedMetricInput = {
  id: string;
  orgId: string;
  practiceId: string;
  periodMonth: string;
  section: string;
  key: string;
  valueNumeric: number | null;
  valueText: string | null;
  source: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdvancedMetricInputWrite = {
  periodMonth: string;
  section: string;
  key: string;
  valueNumeric?: number | null;
  valueText?: string | null;
  source?: string;
  updatedBy?: string | null;
};

export type StoredImportBatch = {
  id: string;
  orgId: string;
  practiceId: string;
  fileName: string;
  fileType: string;
  status: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  skippedRows: number;
  columnMapping: Array<{ sourceColumn: string; targetField: string }> | null;
  headers: string[] | null;
  importType: string;
  createdBy: string | null;
  errorSummary: string | null;
  committedAt: Date | null;
  rawExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportBatchWrite = {
  fileName: string;
  fileType: string;
  status?: string;
  totalRows?: number;
  columnMapping?: Array<{ sourceColumn: string; targetField: string }> | null;
  headers?: string[] | null;
  importType?: string;
  createdBy?: string | null;
  rawExpiresAt: Date;
};

export type ImportBatchPatch = Partial<{
  status: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  skippedRows: number;
  columnMapping: Array<{ sourceColumn: string; targetField: string }> | null;
  headers: string[] | null;
  importType: string;
  errorSummary: string | null;
  committedAt: Date | null;
}>;

/**
 * Callers of the storage layer always see plaintext cells.
 * The `rawData` / `normalizedData` columns hold ciphertext when
 * PHI_ENCRYPTION_KEY is set.
 */
export type StoredImportRow = {
  id: string;
  orgId: string;
  practiceId: string;
  batchId: string;
  rowNumber: number;
  rawData: string;
  normalizedData: string | null;
  status: string;
  errorMessage: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ImportRowWrite = {
  batchId: string;
  rowNumber: number;
  rawData: string;
  normalizedData?: string | null;
  status?: string;
  errorMessage?: string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  contentHash?: string | null;
};

export type ImportRowPatch = Partial<{
  normalizedData: string | null;
  status: string;
  errorMessage: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  rawData: string;
}>;

export type StoredAuditLog = {
  id: string;
  orgId: string;
  practiceId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
};

export type NewAuditLog = {
  orgId: string;
  practiceId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
};

export type StoredPasswordResetToken = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type StoredInvitation = {
  id: string;
  email: string;
  orgId: string;
  practiceId: string;
  role: MembershipRole;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export interface AppStorage {
  createUser(input: {
    email: string;
    username: string;
    passwordHash: string;
    displayName: string;
  }): Promise<StoredUser>;
  getUserById(id: string): Promise<StoredUser | undefined>;
  getUserByEmail(email: string): Promise<StoredUser | undefined>;
  getUserByUsername(username: string): Promise<StoredUser | undefined>;
  getUserByLogin(login: string): Promise<StoredUser | undefined>;
  touchLastLogin(userId: string): Promise<void>;
  updateUser(id: string, patch: UserPatch): Promise<StoredUser | undefined>;

  createOrganization(input: { name: string }): Promise<StoredOrganization>;
  getOrganization(id: string): Promise<StoredOrganization | undefined>;
  updateOrganization(
    id: string,
    patch: OrganizationPatch,
  ): Promise<StoredOrganization | undefined>;
  getOrganizationByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<StoredOrganization | undefined>;
  getOrganizationByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<StoredOrganization | undefined>;
  listPracticesForOrg(orgId: string): Promise<StoredPractice[]>;

  createPractice(input: {
    orgId: string;
    name: string;
  }): Promise<StoredPractice>;
  getPractice(id: string): Promise<StoredPractice | undefined>;
  listPracticesForUser(userId: string): Promise<
    Array<StoredPractice & { role: MembershipRole }>
  >;
  listOrganizationsForUser(userId: string): Promise<
    Array<StoredOrganization & { role: MembershipRole }>
  >;

  createOrgMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredOrgMembership>;
  getOrgMembership(
    userId: string,
    orgId: string,
  ): Promise<StoredOrgMembership | undefined>;
  ensureOrgMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredOrgMembership>;

  createPracticeMembership(input: {
    orgId: string;
    practiceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredPracticeMembership>;
  getPracticeMembership(
    userId: string,
    practiceId: string,
  ): Promise<StoredPracticeMembership | undefined>;
  ensurePracticeMembership(input: {
    orgId: string;
    practiceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredPracticeMembership>;

  createPatient(scope: TenantScope, input: PatientWrite): Promise<StoredPatient>;
  getPatient(scope: TenantScope, id: string): Promise<StoredPatient | undefined>;
  listPatients(scope: TenantScope): Promise<StoredPatient[]>;
  updatePatient(
    scope: TenantScope,
    id: string,
    input: Partial<PatientWrite>,
  ): Promise<StoredPatient | undefined>;
  deletePatient(scope: TenantScope, id: string): Promise<boolean>;

  ensureReferralSource(
    scope: TenantScope,
    name: string,
  ): Promise<StoredReferralSource>;
  getReferralSource(
    scope: TenantScope,
    id: string,
  ): Promise<StoredReferralSource | undefined>;
  listReferralSources(scope: TenantScope): Promise<StoredReferralSource[]>;
  createReferralSource(
    scope: TenantScope,
    input: { name: string; active?: boolean },
  ): Promise<StoredReferralSource>;

  createDailyStat(
    scope: TenantScope,
    input: DailyStatWrite,
  ): Promise<StoredDailyStat>;
  getDailyStatByDate(
    scope: TenantScope,
    date: string,
  ): Promise<StoredDailyStat | undefined>;
  listDailyStats(
    scope: TenantScope,
    range?: DailyStatRange,
  ): Promise<StoredDailyStat[]>;
  updateDailyStatByDate(
    scope: TenantScope,
    date: string,
    input: DailyStatPatch,
  ): Promise<StoredDailyStat | undefined>;
  deleteDailyStatByDate(scope: TenantScope, date: string): Promise<boolean>;

  createGoal(scope: TenantScope, input: GoalWrite): Promise<StoredGoal>;
  getGoal(scope: TenantScope, id: string): Promise<StoredGoal | undefined>;
  listGoals(scope: TenantScope): Promise<StoredGoal[]>;
  updateGoal(
    scope: TenantScope,
    id: string,
    input: GoalPatch,
  ): Promise<StoredGoal | undefined>;
  deleteGoal(scope: TenantScope, id: string): Promise<boolean>;

  createTreatment(
    scope: TenantScope,
    input: TreatmentWrite,
  ): Promise<StoredTreatment>;
  getTreatment(scope: TenantScope, id: string): Promise<StoredTreatment | undefined>;
  listTreatments(scope: TenantScope): Promise<StoredTreatment[]>;
  updateTreatment(
    scope: TenantScope,
    id: string,
    input: TreatmentPatch,
  ): Promise<StoredTreatment | undefined>;
  deleteTreatment(scope: TenantScope, id: string): Promise<boolean>;

  getPracticeSettings(
    scope: TenantScope,
  ): Promise<StoredPracticeSettings | undefined>;
  upsertPracticeSettings(
    scope: TenantScope,
    input: PracticeSettingsPatch,
  ): Promise<StoredPracticeSettings>;

  getCarePlanComplianceAck(
    scope: TenantScope,
    userId: string,
  ): Promise<StoredCarePlanComplianceAck | undefined>;
  upsertCarePlanComplianceAck(
    scope: TenantScope,
    userId: string,
    acknowledgedAt: Date,
  ): Promise<StoredCarePlanComplianceAck>;

  createCarePlanTemplate(
    scope: TenantScope,
    input: CarePlanTemplateWrite,
  ): Promise<StoredCarePlanTemplate>;
  getCarePlanTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<StoredCarePlanTemplate | undefined>;
  listCarePlanTemplates(scope: TenantScope): Promise<StoredCarePlanTemplate[]>;
  updateCarePlanTemplate(
    scope: TenantScope,
    id: string,
    input: CarePlanTemplatePatch,
  ): Promise<StoredCarePlanTemplate | undefined>;
  deleteCarePlanTemplate(scope: TenantScope, id: string): Promise<boolean>;

  createCarePlan(scope: TenantScope, input: CarePlanWrite): Promise<StoredCarePlan>;
  getCarePlan(scope: TenantScope, id: string): Promise<StoredCarePlan | undefined>;
  listCarePlans(scope: TenantScope): Promise<StoredCarePlan[]>;
  updateCarePlan(
    scope: TenantScope,
    id: string,
    input: CarePlanPatch,
  ): Promise<StoredCarePlan | undefined>;
  deleteCarePlan(scope: TenantScope, id: string): Promise<boolean>;

  createPracticeChecklist(
    scope: TenantScope,
    input: PracticeChecklistWrite,
  ): Promise<StoredPracticeChecklist>;
  getPracticeChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPracticeChecklist | undefined>;
  listPracticeChecklists(scope: TenantScope): Promise<StoredPracticeChecklist[]>;
  updatePracticeChecklist(
    scope: TenantScope,
    id: string,
    input: PracticeChecklistPatch,
  ): Promise<StoredPracticeChecklist | undefined>;
  deletePracticeChecklist(scope: TenantScope, id: string): Promise<boolean>;

  createPracticeChecklistItem(
    scope: TenantScope,
    input: PracticeChecklistItemWrite,
  ): Promise<StoredPracticeChecklistItem>;
  getPracticeChecklistItem(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPracticeChecklistItem | undefined>;
  listPracticeChecklistItems(
    scope: TenantScope,
    checklistId?: string,
  ): Promise<StoredPracticeChecklistItem[]>;
  updatePracticeChecklistItem(
    scope: TenantScope,
    id: string,
    input: PracticeChecklistItemPatch,
  ): Promise<StoredPracticeChecklistItem | undefined>;
  deletePracticeChecklistItem(scope: TenantScope, id: string): Promise<boolean>;

  getPracticeChecklistCompletion(
    scope: TenantScope,
    itemId: string,
    completedOn: string,
  ): Promise<StoredPracticeChecklistCompletion | undefined>;
  listPracticeChecklistCompletions(
    scope: TenantScope,
    range?: { from?: string; to?: string },
  ): Promise<StoredPracticeChecklistCompletion[]>;
  upsertPracticeChecklistCompletion(
    scope: TenantScope,
    input: PracticeChecklistCompletionWrite,
  ): Promise<StoredPracticeChecklistCompletion>;

  createChecklistTemplate(
    scope: TenantScope,
    input: ChecklistTemplateWrite,
  ): Promise<StoredChecklistTemplate>;
  getChecklistTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<StoredChecklistTemplate | undefined>;
  listChecklistTemplates(scope: TenantScope): Promise<StoredChecklistTemplate[]>;
  updateChecklistTemplate(
    scope: TenantScope,
    id: string,
    input: ChecklistTemplatePatch,
  ): Promise<StoredChecklistTemplate | undefined>;
  deleteChecklistTemplate(scope: TenantScope, id: string): Promise<boolean>;

  createChecklistTemplateTask(
    scope: TenantScope,
    input: ChecklistTemplateTaskWrite,
  ): Promise<StoredChecklistTemplateTask>;
  getChecklistTemplateTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredChecklistTemplateTask | undefined>;
  listChecklistTemplateTasks(
    scope: TenantScope,
    templateId?: string,
  ): Promise<StoredChecklistTemplateTask[]>;
  updateChecklistTemplateTask(
    scope: TenantScope,
    id: string,
    input: ChecklistTemplateTaskPatch,
  ): Promise<StoredChecklistTemplateTask | undefined>;
  deleteChecklistTemplateTask(scope: TenantScope, id: string): Promise<boolean>;

  createPatientChecklist(
    scope: TenantScope,
    input: PatientChecklistWrite,
  ): Promise<StoredPatientChecklist>;
  getPatientChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatientChecklist | undefined>;
  listPatientChecklists(
    scope: TenantScope,
    patientId?: string,
  ): Promise<StoredPatientChecklist[]>;
  updatePatientChecklist(
    scope: TenantScope,
    id: string,
    input: PatientChecklistPatch,
  ): Promise<StoredPatientChecklist | undefined>;
  deletePatientChecklist(scope: TenantScope, id: string): Promise<boolean>;
  countPatientChecklistsForTemplate(
    scope: TenantScope,
    templateId: string,
  ): Promise<number>;

  createPatientChecklistTask(
    scope: TenantScope,
    input: PatientChecklistTaskWrite,
  ): Promise<StoredPatientChecklistTask>;
  getPatientChecklistTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatientChecklistTask | undefined>;
  listPatientChecklistTasks(
    scope: TenantScope,
    patientChecklistId?: string,
  ): Promise<StoredPatientChecklistTask[]>;
  updatePatientChecklistTask(
    scope: TenantScope,
    id: string,
    input: PatientChecklistTaskPatch,
  ): Promise<StoredPatientChecklistTask | undefined>;
  deletePatientChecklistTask(scope: TenantScope, id: string): Promise<boolean>;

  createProject(scope: TenantScope, input: ProjectWrite): Promise<StoredProject>;
  getProject(scope: TenantScope, id: string): Promise<StoredProject | undefined>;
  listProjects(scope: TenantScope, status?: string): Promise<StoredProject[]>;
  updateProject(
    scope: TenantScope,
    id: string,
    input: ProjectPatch,
  ): Promise<StoredProject | undefined>;
  deleteProject(scope: TenantScope, id: string): Promise<boolean>;

  createProjectColumn(
    scope: TenantScope,
    input: ProjectColumnWrite,
  ): Promise<StoredProjectColumn>;
  getProjectColumn(
    scope: TenantScope,
    id: string,
  ): Promise<StoredProjectColumn | undefined>;
  listProjectColumns(
    scope: TenantScope,
    projectId?: string,
  ): Promise<StoredProjectColumn[]>;
  updateProjectColumn(
    scope: TenantScope,
    id: string,
    input: ProjectColumnPatch,
  ): Promise<StoredProjectColumn | undefined>;
  deleteProjectColumn(scope: TenantScope, id: string): Promise<boolean>;
  countProjectTasksInColumn(
    scope: TenantScope,
    columnId: string,
  ): Promise<number>;

  createProjectTask(
    scope: TenantScope,
    input: ProjectTaskWrite,
  ): Promise<StoredProjectTask>;
  getProjectTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredProjectTask | undefined>;
  listProjectTasks(
    scope: TenantScope,
    projectId?: string,
  ): Promise<StoredProjectTask[]>;
  updateProjectTask(
    scope: TenantScope,
    id: string,
    input: ProjectTaskPatch,
  ): Promise<StoredProjectTask | undefined>;
  deleteProjectTask(scope: TenantScope, id: string): Promise<boolean>;

  listAdvancedMetricInputs(
    scope: TenantScope,
    periodMonth?: string,
  ): Promise<StoredAdvancedMetricInput[]>;
  upsertAdvancedMetricInput(
    scope: TenantScope,
    input: AdvancedMetricInputWrite,
  ): Promise<StoredAdvancedMetricInput>;

  createImportBatch(
    scope: TenantScope,
    input: ImportBatchWrite,
  ): Promise<StoredImportBatch>;
  getImportBatch(
    scope: TenantScope,
    id: string,
  ): Promise<StoredImportBatch | undefined>;
  listImportBatches(scope: TenantScope): Promise<StoredImportBatch[]>;
  updateImportBatch(
    scope: TenantScope,
    id: string,
    input: ImportBatchPatch,
  ): Promise<StoredImportBatch | undefined>;

  createImportRow(
    scope: TenantScope,
    input: ImportRowWrite,
  ): Promise<StoredImportRow>;
  listImportRows(
    scope: TenantScope,
    batchId: string,
  ): Promise<StoredImportRow[]>;
  updateImportRow(
    scope: TenantScope,
    id: string,
    input: ImportRowPatch,
  ): Promise<StoredImportRow | undefined>;
  /**
   * Clears expired raw/normalized payloads. Keeps batch history.
   * Not scheduled — call from the prune stub.
   */
  pruneExpiredImportRawRows(now: Date): Promise<number>;

  createAuditLog(input: NewAuditLog): Promise<StoredAuditLog>;
  listAuditLogs(scope: TenantScope, query?: AuditLogQuery): Promise<StoredAuditLog[]>;
  countAuditLogs(scope: TenantScope): Promise<number>;

  createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredPasswordResetToken>;
  getPasswordResetTokenByHash(
    tokenHash: string,
  ): Promise<StoredPasswordResetToken | undefined>;
  markPasswordResetTokenUsed(id: string, usedAt: Date): Promise<void>;
  invalidatePasswordResetTokensForUser(userId: string, usedAt: Date): Promise<void>;

  createInvitation(input: {
    email: string;
    orgId: string;
    practiceId: string;
    role: MembershipRole;
    tokenHash: string;
    expiresAt: Date;
    invitedBy: string;
  }): Promise<StoredInvitation>;
  getInvitationById(id: string): Promise<StoredInvitation | undefined>;
  getInvitationByTokenHash(
    tokenHash: string,
  ): Promise<StoredInvitation | undefined>;
  listPendingInvitationsForPractice(
    scope: TenantScope,
    now: Date,
  ): Promise<StoredInvitation[]>;
  getPendingInvitationByEmail(
    practiceId: string,
    email: string,
    now: Date,
  ): Promise<StoredInvitation | undefined>;
  markInvitationAccepted(
    id: string,
    acceptedAt: Date,
    acceptedByUserId: string,
  ): Promise<void>;
  revokeInvitation(id: string, revokedAt: Date): Promise<StoredInvitation | undefined>;
}

/**
 * Test-only surface used to prove that removing the practice filter would leak.
 * Production routes must never call unscoped PHI reads.
 */
export interface IsolationProbe {
  listPatientsMissingPracticeFilter(orgId: string): StoredPatient[];
  listDailyStatsMissingPracticeFilter(orgId: string): StoredDailyStat[];
  listGoalsMissingPracticeFilter(orgId: string): StoredGoal[];
  listReferralSourcesMissingPracticeFilter(orgId: string): StoredReferralSource[];
  listTreatmentsMissingPracticeFilter(orgId: string): StoredTreatment[];
  listPracticeChecklistsMissingPracticeFilter(orgId: string): StoredPracticeChecklist[];
  listChecklistTemplatesMissingPracticeFilter(orgId: string): StoredChecklistTemplate[];
  listPatientChecklistsMissingPracticeFilter(orgId: string): StoredPatientChecklist[];
  listCarePlansMissingPracticeFilter(orgId: string): StoredCarePlan[];
  listCarePlanTemplatesMissingPracticeFilter(orgId: string): StoredCarePlanTemplate[];
  listProjectsMissingPracticeFilter(orgId: string): StoredProject[];
  listAdvancedMetricInputsMissingPracticeFilter(
    orgId: string,
  ): StoredAdvancedMetricInput[];
  listImportBatchesMissingPracticeFilter(orgId: string): StoredImportBatch[];
}
