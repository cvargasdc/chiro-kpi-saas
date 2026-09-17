export const MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "clinician",
  "staff",
  "readonly",
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const PHI_WRITE_ROLES: MembershipRole[] = [
  "owner",
  "admin",
  "clinician",
  "staff",
];

export const PHI_READ_ROLES: MembershipRole[] = [
  "owner",
  "admin",
  "clinician",
  "staff",
  "readonly",
];

export const PHI_DELETE_ROLES: MembershipRole[] = ["owner", "admin"];

export const ORG_ADMIN_ROLES: MembershipRole[] = ["owner", "admin"];

export function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}
