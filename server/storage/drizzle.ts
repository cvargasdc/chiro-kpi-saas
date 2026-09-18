import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { MembershipRole } from "@shared/roles";
import { decryptStoredPatient, encryptPhiString } from "../crypto/fields";
import { requireOrgId, requireTenantScope, type TenantScope } from "../tenant/scope";
import type { AuditLogQuery } from "./audit-query";
import type {
  AppStorage,
  NewAuditLog,
  PatientWrite,
  StoredAuditLog,
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
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  async getOrganization(id: string): Promise<StoredOrganization | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
    };
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
        id: schema.organizations.id,
        name: schema.organizations.name,
        status: schema.organizations.status,
        createdAt: schema.organizations.createdAt,
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
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
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
