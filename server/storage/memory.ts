import { randomUUID } from "node:crypto";
import {
  decryptStoredPatient,
  encryptPhiString,
} from "../crypto/fields";
import { requireOrgId, requireTenantScope, type TenantScope } from "../tenant/scope";
import type { AuditLogQuery } from "./audit-query";
import type {
  AppStorage,
  IsolationProbe,
  NewAuditLog,
  PatientWrite,
  StoredAuditLog,
  OrganizationPatch,
  StoredInvitation,
  StoredOrgMembership,
  StoredOrganization,
  StoredPasswordResetToken,
  StoredPatient,
  StoredPractice,
  StoredPracticeMembership,
  StoredUser,
  UserPatch,
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
  /** Serialized rows — email/phone/DOB are ciphertext when PHI_ENCRYPTION_KEY is set. */
  patients: StoredPatient[] = [];
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
    existing.updatedAt = now();
    return decryptStoredPatient(existing, this.phiEncryptionKey);
  }

  async deletePatient(scope: TenantScope, id: string): Promise<boolean> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const index = this.patients.findIndex(
      (p) => p.id === id && p.orgId === orgId && p.practiceId === practiceId,
    );
    if (index === -1) return false;
    this.patients.splice(index, 1);
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
