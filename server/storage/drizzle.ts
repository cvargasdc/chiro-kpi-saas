import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { MembershipRole } from "@shared/roles";
import { requireOrgId, requireTenantScope, type TenantScope } from "../tenant/scope";
import type {
  AppStorage,
  NewAuditLog,
  PatientWrite,
  StoredAuditLog,
  StoredOrgMembership,
  StoredOrganization,
  StoredPatient,
  StoredPractice,
  StoredPracticeMembership,
  StoredUser,
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
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

function mapPatient(row: schema.Patient): StoredPatient {
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
  constructor(private readonly db: Db) {}

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
        email: input.email ?? null,
        phone: input.phone ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        condition: input.condition ?? null,
        status: input.status ?? "active",
      })
      .returning();
    return mapPatient(row);
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
    return row ? mapPatient(row) : undefined;
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
    return rows.map(mapPatient);
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
        email: input.email === undefined ? existing.email : input.email,
        phone: input.phone === undefined ? existing.phone : input.phone,
        dateOfBirth:
          input.dateOfBirth === undefined
            ? existing.dateOfBirth
            : input.dateOfBirth,
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
    return row ? mapPatient(row) : undefined;
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

  async listAuditLogs(scope: TenantScope): Promise<StoredAuditLog[]> {
    const { orgId, practiceId } = requireTenantScope(scope);
    const rows = await this.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.orgId, orgId),
          eq(schema.auditLogs.practiceId, practiceId),
        ),
      );
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
}
