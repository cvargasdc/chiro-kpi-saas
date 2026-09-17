import type { NextFunction, Request, Response } from "express";
import type { MembershipRole } from "@shared/roles";
import type { AppStorage } from "../storage/types";

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function headerValue(req: Request, name: string): string | undefined {
  const raw = req.header(name);
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

export function resolvePracticeId(req: Request): string | undefined {
  return (
    (typeof req.params.practiceId === "string" && req.params.practiceId) ||
    headerValue(req, "x-practice-id") ||
    req.session.activePracticeId
  );
}

export function resolveOrgId(req: Request): string | undefined {
  const bodyOrg =
    req.body && typeof req.body.orgId === "string" ? req.body.orgId.trim() : "";
  return (
    (typeof req.params.orgId === "string" && req.params.orgId) ||
    headerValue(req, "x-org-id") ||
    (bodyOrg || undefined) ||
    req.session.activeOrgId
  );
}

export function authenticate(storage: AppStorage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    const user = await storage.getUserById(userId);
    if (!user || user.status !== "active") {
      req.session.destroy(() => undefined);
      return res.status(401).json({ error: "unauthenticated" });
    }
    req.currentUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
    };
    next();
  };
}

export function requireOrgAccess(storage: AppStorage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    const orgId = resolveOrgId(req);
    if (!orgId) {
      return res.status(400).json({ error: "org_id_required" });
    }
    const membership = await storage.getOrgMembership(req.currentUser.id, orgId);
    if (!membership) {
      return res.status(403).json({ error: "org_access_denied" });
    }
    const org = await storage.getOrganization(orgId);
    if (!org || org.status !== "active") {
      return res.status(403).json({ error: "org_access_denied" });
    }
    req.orgAccess = { orgId, role: membership.role, orgName: org.name };
    next();
  };
}

export function requirePracticeMembership(storage: AppStorage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return res.status(401).json({ error: "unauthenticated" });
    }
    const practiceId = resolvePracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ error: "practice_id_required" });
    }
    const membership = await storage.getPracticeMembership(
      req.currentUser.id,
      practiceId,
    );
    if (!membership) {
      return res.status(403).json({ error: "practice_access_denied" });
    }
    const practice = await storage.getPractice(practiceId);
    if (!practice || practice.status !== "active") {
      return res.status(403).json({ error: "practice_access_denied" });
    }
    const requestedOrgId = resolveOrgId(req);
    if (requestedOrgId && requestedOrgId !== practice.orgId) {
      return res.status(403).json({ error: "practice_access_denied" });
    }
    const org = await storage.getOrganization(practice.orgId);
    req.tenant = {
      orgId: practice.orgId,
      practiceId: practice.id,
      role: membership.role,
      practiceName: practice.name,
      orgName: org?.name ?? "",
    };
    next();
  };
}

export function requireRole(...allowed: MembershipRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenant) {
      return res.status(403).json({ error: "practice_access_denied" });
    }
    if (!allowed.includes(req.tenant.role)) {
      return res.status(403).json({ error: "insufficient_role" });
    }
    next();
  };
}
