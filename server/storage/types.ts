import type { MembershipRole } from "@shared/roles";
import type { TenantScope } from "../tenant/scope";

export type StoredUser = {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
  status: "active" | "suspended" | "disabled";
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type StoredOrganization = {
  id: string;
  name: string;
  status: "active" | "suspended" | "disabled";
  createdAt: Date;
};

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
};

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

  createOrganization(input: { name: string }): Promise<StoredOrganization>;
  getOrganization(id: string): Promise<StoredOrganization | undefined>;

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

  createPatient(scope: TenantScope, input: PatientWrite): Promise<StoredPatient>;
  getPatient(scope: TenantScope, id: string): Promise<StoredPatient | undefined>;
  listPatients(scope: TenantScope): Promise<StoredPatient[]>;
  updatePatient(
    scope: TenantScope,
    id: string,
    input: Partial<PatientWrite>,
  ): Promise<StoredPatient | undefined>;
  deletePatient(scope: TenantScope, id: string): Promise<boolean>;

  createAuditLog(input: NewAuditLog): Promise<StoredAuditLog>;
  listAuditLogs(scope: TenantScope): Promise<StoredAuditLog[]>;
}

/**
 * Test-only surface used to prove that removing the practice filter would leak.
 * Production routes must never call unscoped PHI reads.
 */
export interface IsolationProbe {
  listPatientsMissingPracticeFilter(orgId: string): StoredPatient[];
}
