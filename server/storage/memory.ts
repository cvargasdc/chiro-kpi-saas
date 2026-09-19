import { randomUUID } from "node:crypto";
import {
  decryptStoredDailyStat,
  decryptStoredGoal,
  decryptStoredPatient,
  decryptStoredPatientChecklist,
  decryptStoredPatientChecklistTask,
  encryptPhiString,
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
  IsolationProbe,
  NewAuditLog,
  PatientWrite,
  StoredAuditLog,
  StoredDailyStat,
  StoredGoal,
  OrganizationPatch,
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
} from "./types";
import type { MembershipRole } from "@shared/roles";

function now(): Date {
  return new Date();
}

export class MemoryStorage implements AppStorage, IsolationProbe {
  users = new Map<string, StoredUser>();
  organizations = new Map<string, StoredOrganization>();
  practices = new Map<string, StoredPractice>();
  orgMemberships: StoredOrgMembership[] = [];
  practiceMemberships: StoredPracticeMembership[] = [];
  /** Serialized rows — email/phone/DOB/notes are ciphertext when PHI_ENCRYPTION_KEY is set. */
  patients: StoredPatient[] = [];
  referralSources: StoredReferralSource[] = [];
  /** Notes are ciphertext when PHI_ENCRYPTION_KEY is set. */
  dailyStats: StoredDailyStat[] = [];
  /** Notes are ciphertext when PHI_ENCRYPTION_KEY is set. */
  goals: StoredGoal[] = [];
  treatments: StoredTreatment[] = [];
  practiceChecklists: StoredPracticeChecklist[] = [];
  practiceChecklistItems: StoredPracticeChecklistItem[] = [];
  practiceChecklistCompletions: StoredPracticeChecklistCompletion[] = [];
  checklistTemplates: StoredChecklistTemplate[] = [];
  checklistTemplateTasks: StoredChecklistTemplateTask[] = [];
  /** Notes are ciphertext when PHI_ENCRYPTION_KEY is set. */
  patientChecklists: StoredPatientChecklist[] = [];
  /** Notes are ciphertext when PHI_ENCRYPTION_KEY is set. */
  patientChecklistTasks: StoredPatientChecklistTask[] = [];
  auditLogs: StoredAuditLog[] = [];
  passwordResetTokens: StoredPasswordResetToken[] = [];
  invitations: StoredInvitation[] = [];
  private readonly phiEncryptionKey: string;

  constructor(phiEncryptionKey?: string) {
    this.phiEncryptionKey =
      phiEncryptionKey ?? process.env.PHI_ENCRYPTION_KEY ?? "";
  }

  async createUser(input: {
    email: string;
    username: string;
    passwordHash: string;
    displayName: string;
  }): Promise<StoredUser> {
    const user: StoredUser = {
      id: randomUUID(),
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      status: "active",
      mfaEnabled: false,
      mfaMethod: null,
      mfaSecretEnc: null,
      mfaPendingSecretEnc: null,
      mfaRecoveryCodesHash: null,
      mfaEnrolledAt: null,
      credentialsChangedAt: null,
      lastLoginAt: null,
      createdAt: now(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUserById(id: string): Promise<StoredUser | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<StoredUser | undefined> {
    const needle = email.toLowerCase();
    return [...this.users.values()].find((u) => u.email === needle);
  }

  async getUserByUsername(username: string): Promise<StoredUser | undefined> {
    const needle = username.toLowerCase();
    return [...this.users.values()].find((u) => u.username === needle);
  }

  async getUserByLogin(login: string): Promise<StoredUser | undefined> {
    const needle = login.trim().toLowerCase();
    return (
      (await this.getUserByEmail(needle)) ??
      (await this.getUserByUsername(needle))
    );
  }

  async touchLastLogin(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) user.lastLoginAt = now();
  }

  async updateUser(id: string, patch: UserPatch): Promise<StoredUser | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    if (patch.passwordHash !== undefined) user.passwordHash = patch.passwordHash;
    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.status !== undefined) user.status = patch.status;
    if (patch.mfaEnabled !== undefined) user.mfaEnabled = patch.mfaEnabled;
    if (patch.mfaMethod !== undefined) user.mfaMethod = patch.mfaMethod;
    if (patch.mfaSecretEnc !== undefined) user.mfaSecretEnc = patch.mfaSecretEnc;
    if (patch.mfaPendingSecretEnc !== undefined) {
      user.mfaPendingSecretEnc = patch.mfaPendingSecretEnc;
    }
    if (patch.mfaRecoveryCodesHash !== undefined) {
      user.mfaRecoveryCodesHash = patch.mfaRecoveryCodesHash;
    }
    if (patch.mfaEnrolledAt !== undefined) user.mfaEnrolledAt = patch.mfaEnrolledAt;
    if (patch.credentialsChangedAt !== undefined) {
      user.credentialsChangedAt = patch.credentialsChangedAt;
    }
    return user;
  }

  async createOrganization(input: { name: string }): Promise<StoredOrganization> {
    const org: StoredOrganization = {
      id: randomUUID(),
      name: input.name,
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      plan: null,
      subscriptionStatus: "incomplete",
      trialEndsAt: null,
      createdAt: now(),
    };
    this.organizations.set(org.id, org);
    return org;
  }

  async getOrganization(id: string): Promise<StoredOrganization | undefined> {
    return this.organizations.get(id);
  }

  async updateOrganization(
    id: string,
    patch: OrganizationPatch,
  ): Promise<StoredOrganization | undefined> {
    const org = this.organizations.get(id);
    if (!org) return undefined;
    if (patch.name !== undefined) org.name = patch.name;
    if (patch.status !== undefined) org.status = patch.status;
    if (patch.stripeCustomerId !== undefined) {
      org.stripeCustomerId = patch.stripeCustomerId;
    }
    if (patch.stripeSubscriptionId !== undefined) {
      org.stripeSubscriptionId = patch.stripeSubscriptionId;
    }
    if (patch.plan !== undefined) org.plan = patch.plan;
    if (patch.subscriptionStatus !== undefined) {
      org.subscriptionStatus = patch.subscriptionStatus;
    }
    if (patch.trialEndsAt !== undefined) org.trialEndsAt = patch.trialEndsAt;
    return org;
  }

  async getOrganizationByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<StoredOrganization | undefined> {
    if (!stripeCustomerId) return undefined;
    return [...this.organizations.values()].find(
      (org) => org.stripeCustomerId === stripeCustomerId,
    );
  }

  async getOrganizationByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<StoredOrganization | undefined> {
    if (!stripeSubscriptionId) return undefined;
    return [...this.organizations.values()].find(
      (org) => org.stripeSubscriptionId === stripeSubscriptionId,
    );
  }

  async listPracticesForOrg(orgId: string): Promise<StoredPractice[]> {
    return [...this.practices.values()].filter((p) => p.orgId === orgId);
  }

  async createPractice(input: {
    orgId: string;
    name: string;
  }): Promise<StoredPractice> {
    requireOrgId(input.orgId);
    const practice: StoredPractice = {
      id: randomUUID(),
      orgId: input.orgId,
      name: input.name,
      status: "active",
      createdAt: now(),
    };
    this.practices.set(practice.id, practice);
    return practice;
  }

  async getPractice(id: string): Promise<StoredPractice | undefined> {
    return this.practices.get(id);
  }

  async listPracticesForUser(
    userId: string,
  ): Promise<Array<StoredPractice & { role: MembershipRole }>> {
    const memberships = this.practiceMemberships.filter(
      (m) => m.userId === userId && m.status === "active",
    );
    const result: Array<StoredPractice & { role: MembershipRole }> = [];
    for (const m of memberships) {
      const practice = this.practices.get(m.practiceId);
      if (practice && practice.status === "active") {
        result.push({ ...practice, role: m.role });
      }
    }
    return result;
  }

  async listOrganizationsForUser(
    userId: string,
  ): Promise<Array<StoredOrganization & { role: MembershipRole }>> {
    const memberships = this.orgMemberships.filter(
      (m) => m.userId === userId && m.status === "active",
    );
    const result: Array<StoredOrganization & { role: MembershipRole }> = [];
    for (const m of memberships) {
      const org = this.organizations.get(m.orgId);
      if (org && org.status === "active") {
        result.push({ ...org, role: m.role });
      }
    }
    return result;
  }

  async createOrgMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredOrgMembership> {
    const membership: StoredOrgMembership = {
      id: randomUUID(),
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      status: "active",
    };
    this.orgMemberships.push(membership);
    return membership;
  }

  async getOrgMembership(
    userId: string,
    orgId: string,
  ): Promise<StoredOrgMembership | undefined> {
    return this.orgMemberships.find(
      (m) => m.userId === userId && m.orgId === orgId && m.status === "active",
    );
  }

  async ensureOrgMembership(input: {
    orgId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredOrgMembership> {
    const existing = this.orgMemberships.find(
      (m) => m.userId === input.userId && m.orgId === input.orgId,
    );
    if (existing) {
      if (existing.status !== "active") {
        existing.status = "active";
        existing.role = input.role;
      }
      return existing;
    }
    return this.createOrgMembership(input);
  }

  async createPracticeMembership(input: {
    orgId: string;
    practiceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredPracticeMembership> {
    const membership: StoredPracticeMembership = {
      id: randomUUID(),
      orgId: input.orgId,
      practiceId: input.practiceId,
      userId: input.userId,
      role: input.role,
      status: "active",
    };
    this.practiceMemberships.push(membership);
    return membership;
  }

  async getPracticeMembership(
    userId: string,
    practiceId: string,
  ): Promise<StoredPracticeMembership | undefined> {
    return this.practiceMemberships.find(
      (m) =>
        m.userId === userId &&
        m.practiceId === practiceId &&
        m.status === "active",
    );
  }

  async ensurePracticeMembership(input: {
    orgId: string;
    practiceId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<StoredPracticeMembership> {
    const existing = this.practiceMemberships.find(
      (m) => m.userId === input.userId && m.practiceId === input.practiceId,
    );
    if (existing) {
      if (existing.status !== "active") {
        existing.status = "active";
        existing.role = input.role;
        existing.orgId = input.orgId;
      }
      return existing;
    }
    return this.createPracticeMembership(input);
  }

  async createPatient(
    scope: TenantScope,
    input: PatientWrite,
  ): Promise<StoredPatient> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const patient: StoredPatient = {
      id: randomUUID(),
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
      createdAt: now(),
      updatedAt: now(),
    };
    this.patients.push(patient);
    return decryptStoredPatient(patient, this.phiEncryptionKey);
  }

  async getPatient(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatient | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.patients.find(
      (p) => p.id === id && p.orgId === orgId && p.practiceId === practiceId,
    );
    return row ? decryptStoredPatient(row, this.phiEncryptionKey) : undefined;
  }

  async listPatients(scope: TenantScope): Promise<StoredPatient[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.patients
      .filter((p) => p.orgId === orgId && p.practiceId === practiceId)
      .map((p) => decryptStoredPatient(p, this.phiEncryptionKey));
  }

  /**
   * Deliberately unscoped (org only). Used in tests to prove that dropping
   * the practiceId filter would leak the other practice's patients.
   * NEVER wire this to an HTTP route.
   */
  listPatientsMissingPracticeFilter(orgId: string): StoredPatient[] {
    return this.patients.filter((p) => p.orgId === orgId);
  }

  async updatePatient(
    scope: TenantScope,
    id: string,
    input: Partial<PatientWrite>,
  ): Promise<StoredPatient | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.patients.find(
      (p) => p.id === id && p.orgId === orgId && p.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.name !== undefined) existing.name = input.name;
    if (input.email !== undefined) {
      existing.email = encryptPhiString(input.email, this.phiEncryptionKey);
    }
    if (input.phone !== undefined) {
      existing.phone = encryptPhiString(input.phone, this.phiEncryptionKey);
    }
    if (input.dateOfBirth !== undefined) {
      existing.dateOfBirth = encryptPhiString(
        input.dateOfBirth,
        this.phiEncryptionKey,
      );
    }
    if (input.condition !== undefined) existing.condition = input.condition;
    if (input.status !== undefined) existing.status = input.status;
    if (input.patientType !== undefined) existing.patientType = input.patientType;
    if (input.typeName !== undefined) existing.typeName = input.typeName;
    if (input.referralSourceId !== undefined) {
      existing.referralSourceId = input.referralSourceId;
    }
    if (input.referralSource !== undefined) {
      existing.referralSource = input.referralSource;
    }
    if (input.day1Date !== undefined) existing.day1Date = input.day1Date;
    if (input.day2Date !== undefined) existing.day2Date = input.day2Date;
    if (input.careStatus !== undefined) existing.careStatus = input.careStatus;
    if (input.converted !== undefined) existing.converted = input.converted;
    if (input.conversionDate !== undefined) {
      existing.conversionDate = input.conversionDate;
    }
    if (input.planType !== undefined) existing.planType = input.planType;
    if (input.notes !== undefined) {
      existing.notes = encryptPhiString(input.notes, this.phiEncryptionKey);
    }
    if (input.createdBy !== undefined) existing.createdBy = input.createdBy;
    existing.updatedAt = now();
    return decryptStoredPatient(existing, this.phiEncryptionKey);
  }

  async deletePatient(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.patients.findIndex(
      (p) => p.id === id && p.orgId === orgId && p.practiceId === practiceId,
    );
    if (index === -1) return false;
    const checklistIds = this.patientChecklists
      .filter(
        (row) =>
          row.patientId === id &&
          row.orgId === orgId &&
          row.practiceId === practiceId,
      )
      .map((row) => row.id);
    this.patientChecklistTasks = this.patientChecklistTasks.filter(
      (row) => !checklistIds.includes(row.patientChecklistId),
    );
    this.patientChecklists = this.patientChecklists.filter(
      (row) => !checklistIds.includes(row.id),
    );
    this.patients.splice(index, 1);
    return true;
  }

  listReferralSourcesMissingPracticeFilter(orgId: string): StoredReferralSource[] {
    return this.referralSources.filter((row) => row.orgId === orgId);
  }

  async listReferralSources(scope: TenantScope): Promise<StoredReferralSource[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.referralSources
      .filter((row) => row.orgId === orgId && row.practiceId === practiceId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getReferralSource(
    scope: TenantScope,
    id: string,
  ): Promise<StoredReferralSource | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.referralSources.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
  }

  async createReferralSource(
    scope: TenantScope,
    input: { name: string; active?: boolean },
  ): Promise<StoredReferralSource> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredReferralSource = {
      id: randomUUID(),
      orgId,
      practiceId,
      name: input.name,
      active: input.active ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.referralSources.push(row);
    return row;
  }

  async ensureReferralSource(
    scope: TenantScope,
    name: string,
  ): Promise<StoredReferralSource> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const needle = name.trim().toLowerCase();
    const existing = this.referralSources.find(
      (row) =>
        row.orgId === orgId &&
        row.practiceId === practiceId &&
        row.name.toLowerCase() === needle,
    );
    if (existing) {
      if (!existing.active) {
        existing.active = true;
        existing.updatedAt = now();
      }
      return existing;
    }
    return this.createReferralSource(scope, { name: name.trim(), active: true });
  }

  async createDailyStat(
    scope: TenantScope,
    input: DailyStatWrite,
  ): Promise<StoredDailyStat> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const duplicate = this.dailyStats.some(
      (row) =>
        row.orgId === orgId &&
        row.practiceId === practiceId &&
        row.date === input.date,
    );
    if (duplicate) {
      throw new DuplicateDailyLogError(input.date);
    }
    const row: StoredDailyStat = {
      id: randomUUID(),
      orgId,
      practiceId,
      date: input.date,
      visits: input.visits,
      revenueCents: input.revenueCents,
      notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
      createdBy: input.createdBy ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.dailyStats.push(row);
    return decryptStoredDailyStat(row, this.phiEncryptionKey);
  }

  async getDailyStatByDate(
    scope: TenantScope,
    date: string,
  ): Promise<StoredDailyStat | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.dailyStats.find(
      (item) =>
        item.orgId === orgId &&
        item.practiceId === practiceId &&
        item.date === date,
    );
    return row ? decryptStoredDailyStat(row, this.phiEncryptionKey) : undefined;
  }

  async listDailyStats(
    scope: TenantScope,
    range?: DailyStatRange,
  ): Promise<StoredDailyStat[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.dailyStats
      .filter((row) => {
        if (row.orgId !== orgId || row.practiceId !== practiceId) return false;
        if (range?.from && row.date < range.from) return false;
        if (range?.to && row.date > range.to) return false;
        return true;
      })
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((row) => decryptStoredDailyStat(row, this.phiEncryptionKey));
  }

  /**
   * Deliberately unscoped (org only). Test-only. NEVER wire to an HTTP route.
   */
  listDailyStatsMissingPracticeFilter(orgId: string): StoredDailyStat[] {
    return this.dailyStats.filter((row) => row.orgId === orgId);
  }

  async updateDailyStatByDate(
    scope: TenantScope,
    date: string,
    input: DailyStatPatch,
  ): Promise<StoredDailyStat | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.dailyStats.find(
      (row) =>
        row.orgId === orgId &&
        row.practiceId === practiceId &&
        row.date === date,
    );
    if (!existing) return undefined;
    if (input.visits !== undefined) existing.visits = input.visits;
    if (input.revenueCents !== undefined) {
      existing.revenueCents = input.revenueCents;
    }
    if (input.notes !== undefined) {
      existing.notes = encryptPhiString(input.notes, this.phiEncryptionKey);
    }
    existing.updatedAt = now();
    return decryptStoredDailyStat(existing, this.phiEncryptionKey);
  }

  async deleteDailyStatByDate(
    scope: TenantScope,
    date: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.dailyStats.findIndex(
      (row) =>
        row.orgId === orgId &&
        row.practiceId === practiceId &&
        row.date === date,
    );
    if (index === -1) return false;
    this.dailyStats.splice(index, 1);
    return true;
  }

  async createGoal(scope: TenantScope, input: GoalWrite): Promise<StoredGoal> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredGoal = {
      id: randomUUID(),
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
      createdAt: now(),
      updatedAt: now(),
    };
    this.goals.push(row);
    return decryptStoredGoal(row, this.phiEncryptionKey);
  }

  async getGoal(scope: TenantScope, id: string): Promise<StoredGoal | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.goals.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row ? decryptStoredGoal(row, this.phiEncryptionKey) : undefined;
  }

  async listGoals(scope: TenantScope): Promise<StoredGoal[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.goals
      .filter((row) => row.orgId === orgId && row.practiceId === practiceId)
      .slice()
      .sort((a, b) => {
        const end = b.endDate.localeCompare(a.endDate);
        if (end !== 0) return end;
        const start = b.startDate.localeCompare(a.startDate);
        if (start !== 0) return start;
        return a.name.localeCompare(b.name);
      })
      .map((row) => decryptStoredGoal(row, this.phiEncryptionKey));
  }

  /**
   * Deliberately unscoped (org only). Test-only. NEVER wire to an HTTP route.
   */
  listGoalsMissingPracticeFilter(orgId: string): StoredGoal[] {
    return this.goals.filter((row) => row.orgId === orgId);
  }

  async updateGoal(
    scope: TenantScope,
    id: string,
    input: GoalPatch,
  ): Promise<StoredGoal | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.goals.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.name !== undefined) existing.name = input.name;
    if (input.metricType !== undefined) existing.metricType = input.metricType;
    if (input.targetValue !== undefined) existing.targetValue = input.targetValue;
    if (input.currentValue !== undefined) existing.currentValue = input.currentValue;
    if (input.timePeriod !== undefined) existing.timePeriod = input.timePeriod;
    if (input.startDate !== undefined) existing.startDate = input.startDate;
    if (input.endDate !== undefined) existing.endDate = input.endDate;
    if (input.notes !== undefined) {
      existing.notes = encryptPhiString(input.notes, this.phiEncryptionKey);
    }
    existing.updatedAt = now();
    return decryptStoredGoal(existing, this.phiEncryptionKey);
  }

  async deleteGoal(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.goals.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.goals.splice(index, 1);
    return true;
  }

  async createTreatment(
    scope: TenantScope,
    input: TreatmentWrite,
  ): Promise<StoredTreatment> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredTreatment = {
      id: randomUUID(),
      orgId,
      practiceId,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      priceCents: input.priceCents,
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.treatments.push(row);
    return { ...row };
  }

  async getTreatment(
    scope: TenantScope,
    id: string,
  ): Promise<StoredTreatment | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.treatments.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row ? { ...row } : undefined;
  }

  async listTreatments(scope: TenantScope): Promise<StoredTreatment[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.treatments
      .filter((row) => row.orgId === orgId && row.practiceId === practiceId)
      .slice()
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        const cat = a.category.localeCompare(b.category);
        if (cat !== 0) return cat;
        return a.name.localeCompare(b.name);
      })
      .map((row) => ({ ...row }));
  }

  /**
   * Deliberately unscoped (org only). Test-only. NEVER wire to an HTTP route.
   */
  listTreatmentsMissingPracticeFilter(orgId: string): StoredTreatment[] {
    return this.treatments.filter((row) => row.orgId === orgId);
  }

  async updateTreatment(
    scope: TenantScope,
    id: string,
    input: TreatmentPatch,
  ): Promise<StoredTreatment | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.treatments.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.name !== undefined) existing.name = input.name;
    if (input.description !== undefined) existing.description = input.description;
    if (input.category !== undefined) existing.category = input.category;
    if (input.priceCents !== undefined) existing.priceCents = input.priceCents;
    if (input.active !== undefined) existing.active = input.active;
    if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
    existing.updatedAt = now();
    return { ...existing };
  }

  async deleteTreatment(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.treatments.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.treatments.splice(index, 1);
    return true;
  }

  async createPracticeChecklist(
    scope: TenantScope,
    input: PracticeChecklistWrite,
  ): Promise<StoredPracticeChecklist> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredPracticeChecklist = {
      id: randomUUID(),
      orgId,
      practiceId,
      name: input.name,
      cadence: input.cadence,
      active: input.active ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.practiceChecklists.push(row);
    return { ...row };
  }

  async getPracticeChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPracticeChecklist | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.practiceChecklists.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row ? { ...row } : undefined;
  }

  async listPracticeChecklists(
    scope: TenantScope,
  ): Promise<StoredPracticeChecklist[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.practiceChecklists
      .filter((row) => row.orgId === orgId && row.practiceId === practiceId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({ ...row }));
  }

  listPracticeChecklistsMissingPracticeFilter(
    orgId: string,
  ): StoredPracticeChecklist[] {
    return this.practiceChecklists.filter((row) => row.orgId === orgId);
  }

  async updatePracticeChecklist(
    scope: TenantScope,
    id: string,
    input: PracticeChecklistPatch,
  ): Promise<StoredPracticeChecklist | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.practiceChecklists.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.name !== undefined) existing.name = input.name;
    if (input.cadence !== undefined) existing.cadence = input.cadence;
    if (input.active !== undefined) existing.active = input.active;
    existing.updatedAt = now();
    return { ...existing };
  }

  async deletePracticeChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.practiceChecklists.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    const itemIds = this.practiceChecklistItems
      .filter((row) => row.checklistId === id)
      .map((row) => row.id);
    this.practiceChecklistCompletions = this.practiceChecklistCompletions.filter(
      (row) => !itemIds.includes(row.itemId),
    );
    this.practiceChecklistItems = this.practiceChecklistItems.filter(
      (row) => row.checklistId !== id,
    );
    this.practiceChecklists.splice(index, 1);
    return true;
  }

  async createPracticeChecklistItem(
    scope: TenantScope,
    input: PracticeChecklistItemWrite,
  ): Promise<StoredPracticeChecklistItem> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredPracticeChecklistItem = {
      id: randomUUID(),
      orgId,
      practiceId,
      checklistId: input.checklistId,
      title: input.title,
      category: input.category,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.practiceChecklistItems.push(row);
    return { ...row };
  }

  async getPracticeChecklistItem(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPracticeChecklistItem | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.practiceChecklistItems.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row ? { ...row } : undefined;
  }

  async listPracticeChecklistItems(
    scope: TenantScope,
    checklistId?: string,
  ): Promise<StoredPracticeChecklistItem[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.practiceChecklistItems
      .filter(
        (row) =>
          row.orgId === orgId &&
          row.practiceId === practiceId &&
          (checklistId ? row.checklistId === checklistId : true),
      )
      .slice()
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.title.localeCompare(b.title);
      })
      .map((row) => ({ ...row }));
  }

  async updatePracticeChecklistItem(
    scope: TenantScope,
    id: string,
    input: PracticeChecklistItemPatch,
  ): Promise<StoredPracticeChecklistItem | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.practiceChecklistItems.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.title !== undefined) existing.title = input.title;
    if (input.category !== undefined) existing.category = input.category;
    if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
    if (input.active !== undefined) existing.active = input.active;
    existing.updatedAt = now();
    return { ...existing };
  }

  async deletePracticeChecklistItem(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.practiceChecklistItems.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.practiceChecklistCompletions = this.practiceChecklistCompletions.filter(
      (row) => row.itemId !== id,
    );
    this.practiceChecklistItems.splice(index, 1);
    return true;
  }

  async getPracticeChecklistCompletion(
    scope: TenantScope,
    itemId: string,
    completedOn: string,
  ): Promise<StoredPracticeChecklistCompletion | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.practiceChecklistCompletions.find(
      (item) =>
        item.itemId === itemId &&
        item.completedOn === completedOn &&
        item.orgId === orgId &&
        item.practiceId === practiceId,
    );
    return row ? { ...row } : undefined;
  }

  async listPracticeChecklistCompletions(
    scope: TenantScope,
    range?: { from?: string; to?: string },
  ): Promise<StoredPracticeChecklistCompletion[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.practiceChecklistCompletions
      .filter((row) => {
        if (row.orgId !== orgId || row.practiceId !== practiceId) return false;
        if (range?.from && row.completedOn < range.from) return false;
        if (range?.to && row.completedOn > range.to) return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.completedOn.localeCompare(b.completedOn))
      .map((row) => ({ ...row }));
  }

  async upsertPracticeChecklistCompletion(
    scope: TenantScope,
    input: PracticeChecklistCompletionWrite,
  ): Promise<StoredPracticeChecklistCompletion> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.practiceChecklistCompletions.find(
      (row) =>
        row.itemId === input.itemId &&
        row.completedOn === input.completedOn &&
        row.orgId === orgId &&
        row.practiceId === practiceId,
    );
    if (existing) {
      existing.completed = input.completed;
      if (input.completedBy !== undefined) {
        existing.completedBy = input.completedBy;
      }
      existing.updatedAt = now();
      return { ...existing };
    }
    const row: StoredPracticeChecklistCompletion = {
      id: randomUUID(),
      orgId,
      practiceId,
      itemId: input.itemId,
      completedOn: input.completedOn,
      completedBy: input.completedBy ?? null,
      completed: input.completed,
      createdAt: now(),
      updatedAt: now(),
    };
    this.practiceChecklistCompletions.push(row);
    return { ...row };
  }

  async createChecklistTemplate(
    scope: TenantScope,
    input: ChecklistTemplateWrite,
  ): Promise<StoredChecklistTemplate> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredChecklistTemplate = {
      id: randomUUID(),
      orgId,
      practiceId,
      name: input.name,
      patientType: input.patientType,
      active: input.active ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.checklistTemplates.push(row);
    return { ...row };
  }

  async getChecklistTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<StoredChecklistTemplate | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.checklistTemplates.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row ? { ...row } : undefined;
  }

  async listChecklistTemplates(
    scope: TenantScope,
  ): Promise<StoredChecklistTemplate[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.checklistTemplates
      .filter((row) => row.orgId === orgId && row.practiceId === practiceId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({ ...row }));
  }

  listChecklistTemplatesMissingPracticeFilter(
    orgId: string,
  ): StoredChecklistTemplate[] {
    return this.checklistTemplates.filter((row) => row.orgId === orgId);
  }

  async updateChecklistTemplate(
    scope: TenantScope,
    id: string,
    input: ChecklistTemplatePatch,
  ): Promise<StoredChecklistTemplate | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.checklistTemplates.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.name !== undefined) existing.name = input.name;
    if (input.patientType !== undefined) existing.patientType = input.patientType;
    if (input.active !== undefined) existing.active = input.active;
    existing.updatedAt = now();
    return { ...existing };
  }

  async deleteChecklistTemplate(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const assigned = this.patientChecklists.some(
      (row) =>
        row.templateId === id &&
        row.orgId === orgId &&
        row.practiceId === practiceId,
    );
    if (assigned) return false;
    const index = this.checklistTemplates.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.checklistTemplateTasks = this.checklistTemplateTasks.filter(
      (row) => row.templateId !== id,
    );
    this.checklistTemplates.splice(index, 1);
    return true;
  }

  async createChecklistTemplateTask(
    scope: TenantScope,
    input: ChecklistTemplateTaskWrite,
  ): Promise<StoredChecklistTemplateTask> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredChecklistTemplateTask = {
      id: randomUUID(),
      orgId,
      practiceId,
      templateId: input.templateId,
      title: input.title,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.checklistTemplateTasks.push(row);
    return { ...row };
  }

  async getChecklistTemplateTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredChecklistTemplateTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.checklistTemplateTasks.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row ? { ...row } : undefined;
  }

  async listChecklistTemplateTasks(
    scope: TenantScope,
    templateId?: string,
  ): Promise<StoredChecklistTemplateTask[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.checklistTemplateTasks
      .filter(
        (row) =>
          row.orgId === orgId &&
          row.practiceId === practiceId &&
          (templateId ? row.templateId === templateId : true),
      )
      .slice()
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.title.localeCompare(b.title);
      })
      .map((row) => ({ ...row }));
  }

  async updateChecklistTemplateTask(
    scope: TenantScope,
    id: string,
    input: ChecklistTemplateTaskPatch,
  ): Promise<StoredChecklistTemplateTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.checklistTemplateTasks.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.title !== undefined) existing.title = input.title;
    if (input.description !== undefined) existing.description = input.description;
    if (input.sortOrder !== undefined) existing.sortOrder = input.sortOrder;
    existing.updatedAt = now();
    return { ...existing };
  }

  async deleteChecklistTemplateTask(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.checklistTemplateTasks.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.checklistTemplateTasks.splice(index, 1);
    return true;
  }

  async createPatientChecklist(
    scope: TenantScope,
    input: PatientChecklistWrite,
  ): Promise<StoredPatientChecklist> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredPatientChecklist = {
      id: randomUUID(),
      orgId,
      practiceId,
      patientId: input.patientId,
      templateId: input.templateId ?? null,
      templateName: input.templateName,
      status: input.status ?? "not_started",
      notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
      createdAt: now(),
      updatedAt: now(),
    };
    this.patientChecklists.push(row);
    return decryptStoredPatientChecklist(row, this.phiEncryptionKey);
  }

  async getPatientChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatientChecklist | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.patientChecklists.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row
      ? decryptStoredPatientChecklist(row, this.phiEncryptionKey)
      : undefined;
  }

  async listPatientChecklists(
    scope: TenantScope,
    patientId?: string,
  ): Promise<StoredPatientChecklist[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.patientChecklists
      .filter(
        (row) =>
          row.orgId === orgId &&
          row.practiceId === practiceId &&
          (patientId ? row.patientId === patientId : true),
      )
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => decryptStoredPatientChecklist(row, this.phiEncryptionKey));
  }

  listPatientChecklistsMissingPracticeFilter(
    orgId: string,
  ): StoredPatientChecklist[] {
    return this.patientChecklists
      .filter((row) => row.orgId === orgId)
      .map((row) => decryptStoredPatientChecklist(row, this.phiEncryptionKey));
  }

  async updatePatientChecklist(
    scope: TenantScope,
    id: string,
    input: PatientChecklistPatch,
  ): Promise<StoredPatientChecklist | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.patientChecklists.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.templateId !== undefined) existing.templateId = input.templateId;
    if (input.templateName !== undefined) existing.templateName = input.templateName;
    if (input.status !== undefined) existing.status = input.status;
    if (input.notes !== undefined) {
      existing.notes = encryptPhiString(input.notes, this.phiEncryptionKey);
    }
    existing.updatedAt = now();
    return decryptStoredPatientChecklist(existing, this.phiEncryptionKey);
  }

  async deletePatientChecklist(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.patientChecklists.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.patientChecklistTasks = this.patientChecklistTasks.filter(
      (row) => row.patientChecklistId !== id,
    );
    this.patientChecklists.splice(index, 1);
    return true;
  }

  async countPatientChecklistsForTemplate(
    scope: TenantScope,
    templateId: string,
  ): Promise<number> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.patientChecklists.filter(
      (row) =>
        row.templateId === templateId &&
        row.orgId === orgId &&
        row.practiceId === practiceId,
    ).length;
  }

  async createPatientChecklistTask(
    scope: TenantScope,
    input: PatientChecklistTaskWrite,
  ): Promise<StoredPatientChecklistTask> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row: StoredPatientChecklistTask = {
      id: randomUUID(),
      orgId,
      practiceId,
      patientChecklistId: input.patientChecklistId,
      title: input.title,
      done: input.done ?? false,
      assigneeName: input.assigneeName ?? null,
      notes: encryptPhiString(input.notes ?? null, this.phiEncryptionKey),
      completedAt: input.completedAt ?? null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.patientChecklistTasks.push(row);
    return decryptStoredPatientChecklistTask(row, this.phiEncryptionKey);
  }

  async getPatientChecklistTask(
    scope: TenantScope,
    id: string,
  ): Promise<StoredPatientChecklistTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const row = this.patientChecklistTasks.find(
      (item) =>
        item.id === id && item.orgId === orgId && item.practiceId === practiceId,
    );
    return row
      ? decryptStoredPatientChecklistTask(row, this.phiEncryptionKey)
      : undefined;
  }

  async listPatientChecklistTasks(
    scope: TenantScope,
    patientChecklistId?: string,
  ): Promise<StoredPatientChecklistTask[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.patientChecklistTasks
      .filter(
        (row) =>
          row.orgId === orgId &&
          row.practiceId === practiceId &&
          (patientChecklistId
            ? row.patientChecklistId === patientChecklistId
            : true),
      )
      .slice()
      .sort((a, b) => {
        const byParent = a.patientChecklistId.localeCompare(b.patientChecklistId);
        if (byParent !== 0) return byParent;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })
      .map((row) =>
        decryptStoredPatientChecklistTask(row, this.phiEncryptionKey),
      );
  }

  async updatePatientChecklistTask(
    scope: TenantScope,
    id: string,
    input: PatientChecklistTaskPatch,
  ): Promise<StoredPatientChecklistTask | undefined> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const existing = this.patientChecklistTasks.find(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (!existing) return undefined;
    if (input.title !== undefined) existing.title = input.title;
    if (input.done !== undefined) existing.done = input.done;
    if (input.assigneeName !== undefined) existing.assigneeName = input.assigneeName;
    if (input.notes !== undefined) {
      existing.notes = encryptPhiString(input.notes, this.phiEncryptionKey);
    }
    if (input.completedAt !== undefined) existing.completedAt = input.completedAt;
    existing.updatedAt = now();
    return decryptStoredPatientChecklistTask(existing, this.phiEncryptionKey);
  }

  async deletePatientChecklistTask(
    scope: TenantScope,
    id: string,
  ): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.patientChecklistTasks.findIndex(
      (row) =>
        row.id === id && row.orgId === orgId && row.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.patientChecklistTasks.splice(index, 1);
    return true;
  }

  async createAuditLog(input: NewAuditLog): Promise<StoredAuditLog> {
    const scope = requireTenantScope({
      orgId: input.orgId,
      practiceId: input.practiceId,
    });
    const row: StoredAuditLog = {
      id: randomUUID(),
      orgId: scope.orgId,
      practiceId: scope.practiceId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      createdAt: now(),
    };
    this.auditLogs.push(row);
    return row;
  }

  async listAuditLogs(
    scope: TenantScope,
    query?: AuditLogQuery,
  ): Promise<StoredAuditLog[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    let rows = this.auditLogs
      .filter((row) => row.orgId === orgId && row.practiceId === practiceId)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (query?.offset) rows = rows.slice(query.offset);
    if (query?.limit != null) rows = rows.slice(0, query.limit);
    return rows;
  }

  async countAuditLogs(scope: TenantScope): Promise<number> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.auditLogs.filter(
      (row) => row.orgId === orgId && row.practiceId === practiceId,
    ).length;
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<StoredPasswordResetToken> {
    const row: StoredPasswordResetToken = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: now(),
    };
    this.passwordResetTokens.push(row);
    return row;
  }

  async getPasswordResetTokenByHash(
    tokenHash: string,
  ): Promise<StoredPasswordResetToken | undefined> {
    return this.passwordResetTokens.find((row) => row.tokenHash === tokenHash);
  }

  async markPasswordResetTokenUsed(id: string, usedAt: Date): Promise<void> {
    const row = this.passwordResetTokens.find((item) => item.id === id);
    if (row) row.usedAt = usedAt;
  }

  async invalidatePasswordResetTokensForUser(
    userId: string,
    usedAt: Date,
  ): Promise<void> {
    for (const row of this.passwordResetTokens) {
      if (row.userId === userId && !row.usedAt) {
        row.usedAt = usedAt;
      }
    }
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
    const row: StoredInvitation = {
      id: randomUUID(),
      email: input.email,
      orgId: input.orgId,
      practiceId: input.practiceId,
      role: input.role,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      invitedBy: input.invitedBy,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      createdAt: now(),
    };
    this.invitations.push(row);
    return row;
  }

  async getInvitationById(id: string): Promise<StoredInvitation | undefined> {
    return this.invitations.find((row) => row.id === id);
  }

  async getInvitationByTokenHash(
    tokenHash: string,
  ): Promise<StoredInvitation | undefined> {
    return this.invitations.find((row) => row.tokenHash === tokenHash);
  }

  async listPendingInvitationsForPractice(
    scope: TenantScope,
    nowDate: Date,
  ): Promise<StoredInvitation[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    return this.invitations.filter(
      (row) =>
        row.orgId === orgId &&
        row.practiceId === practiceId &&
        !row.acceptedAt &&
        !row.revokedAt &&
        row.expiresAt.getTime() > nowDate.getTime(),
    );
  }

  async getPendingInvitationByEmail(
    practiceId: string,
    email: string,
    nowDate: Date,
  ): Promise<StoredInvitation | undefined> {
    return this.invitations.find(
      (row) =>
        row.practiceId === practiceId &&
        row.email === email &&
        !row.acceptedAt &&
        !row.revokedAt &&
        row.expiresAt.getTime() > nowDate.getTime(),
    );
  }

  async markInvitationAccepted(
    id: string,
    acceptedAt: Date,
    acceptedByUserId: string,
  ): Promise<void> {
    const row = this.invitations.find((item) => item.id === id);
    if (row) {
      row.acceptedAt = acceptedAt;
      row.acceptedByUserId = acceptedByUserId;
    }
  }

  async revokeInvitation(
    id: string,
    revokedAt: Date,
  ): Promise<StoredInvitation | undefined> {
    const row = this.invitations.find((item) => item.id === id);
    if (!row || row.acceptedAt || row.revokedAt) return undefined;
    row.revokedAt = revokedAt;
    return row;
  }
}

export function createMemoryStorage(opts?: {
  phiEncryptionKey?: string;
}): MemoryStorage {
  return new MemoryStorage(opts?.phiEncryptionKey);
}
