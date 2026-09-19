import type { MembershipRole } from "@shared/roles";

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
  mfaEnabled: boolean;
};

export type TenantContext = {
  orgId: string;
  practiceId: string;
  role: MembershipRole;
  practiceName: string;
  orgName: string;
};

export type OrgAccessContext = {
  orgId: string;
  role: MembershipRole;
  orgName: string;
};

declare module "express-session" {
  interface SessionData {
    userId?: string;
    activeOrgId?: string;
    activePracticeId?: string;
    authIssuedAt?: string;
    carePlanComplianceAcknowledgedAt?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      currentUser?: SessionUser;
      tenant?: TenantContext;
      orgAccess?: OrgAccessContext;
    }
  }
}

export {};
