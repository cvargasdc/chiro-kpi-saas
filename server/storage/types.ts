import type { SubscriptionStatus } from "@shared/billing";
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
}
