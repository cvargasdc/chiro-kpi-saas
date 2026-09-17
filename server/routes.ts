import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  normalizeEmail,
  normalizeUsername,
  USERNAME_PATTERN,
  validatePassword,
} from "@shared/password-policy";
import {
  PHI_DELETE_ROLES,
  PHI_READ_ROLES,
  PHI_WRITE_ROLES,
} from "@shared/roles";
import { logAudit } from "./audit/logAudit";
import { getMfaStatus } from "./auth/mfa";
import {
  authenticate,
  getClientIp,
  requireOrgAccess,
  requirePracticeMembership,
  requireRole,
} from "./auth/middleware";
import { hashPassword, verifyPasswordOrDummy } from "./auth/password";
import { importNotImplemented } from "./import/csv-excel-stub";
import type { AppStorage } from "./storage/types";

const registerSchema = z.object({
  email: z.string().email().max(320),
  username: z.string().regex(USERNAME_PATTERN, "Username must be 3-64 characters (letters, numbers, . _ -)"),
  password: z.string(),
  displayName: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(200),
  practiceName: z.string().min(1).max(200),
});

const loginSchema = z.object({
  login: z.string().min(1).max(320),
  password: z.string().min(1),
});

const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  practiceName: z.string().min(1).max(200).optional(),
});

const createPracticeSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(200),
});

const patientWriteSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  dateOfBirth: z.string().max(10).optional().nullable(),
  condition: z.string().max(500).optional().nullable(),
  status: z.string().max(40).optional(),
});

const patientPatchSchema = patientWriteSchema.partial();

const contextSchema = z.object({
  orgId: z.string().min(1),
  practiceId: z.string().min(1),
});

function publicUser(user: {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    mfa: getMfaStatus(),
  };
}

function establishSession(
  req: Request,
  userId: string,
  orgId: string,
  practiceId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.activeOrgId = orgId;
      req.session.activePracticeId = practiceId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

export function registerRoutes(app: Express, storage: AppStorage): void {
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const orgGate = requireOrgAccess(storage);

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "chiro-kpi",
      path: "B",
      phi: "full",
      openai: false,
      chirotouch: false,
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const policy = validatePassword(parsed.data.password);
    if (!policy.ok) {
      return res.status(400).json({ error: "password_policy", details: policy.errors });
    }

    const email = normalizeEmail(parsed.data.email);
    const username = normalizeUsername(parsed.data.username);

    if (await storage.getUserByEmail(email)) {
      return res.status(409).json({ error: "email_taken" });
    }
    if (await storage.getUserByUsername(username)) {
      return res.status(409).json({ error: "username_taken" });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await storage.createUser({
      email,
      username,
      passwordHash,
      displayName: parsed.data.displayName.trim(),
    });
    const org = await storage.createOrganization({
      name: parsed.data.organizationName.trim(),
    });
    const practice = await storage.createPractice({
      orgId: org.id,
      name: parsed.data.practiceName.trim(),
    });
    await storage.createOrgMembership({
      orgId: org.id,
      userId: user.id,
      role: "owner",
    });
    await storage.createPracticeMembership({
      orgId: org.id,
      practiceId: practice.id,
      userId: user.id,
      role: "owner",
    });
    await storage.touchLastLogin(user.id);
    await establishSession(req, user.id, org.id, practice.id);

    return res.status(201).json({
      user: publicUser(user),
      organization: { id: org.id, name: org.name },
      practice: { id: practice.id, name: practice.name, orgId: org.id, role: "owner" },
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const user = await storage.getUserByLogin(parsed.data.login);
    const passwordOk = await verifyPasswordOrDummy(
      parsed.data.password,
      user?.passwordHash,
    );
    if (!user || user.status !== "active" || !passwordOk) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const practices = await storage.listPracticesForUser(user.id);
    const first = practices[0];
    await storage.touchLastLogin(user.id);
    await establishSession(
      req,
      user.id,
      first?.orgId ?? "",
      first?.id ?? "",
    );

    return res.json({
      user: publicUser(user),
      practice: first
        ? { id: first.id, name: first.name, orgId: first.orgId, role: first.role }
        : null,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("chirokpi.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/me", auth, async (req, res) => {
    const user = req.currentUser!;
    const [organizations, practices] = await Promise.all([
      storage.listOrganizationsForUser(user.id),
      storage.listPracticesForUser(user.id),
    ]);
    const activePractice = practices.find(
      (p) => p.id === req.session.activePracticeId,
    ) ?? practices[0];
    const activeOrg = organizations.find(
      (o) => o.id === (activePractice?.orgId ?? req.session.activeOrgId),
    ) ?? organizations[0];

    res.json({
      user: publicUser(user),
      organizations: organizations.map((o) => ({
        id: o.id,
        name: o.name,
        role: o.role,
      })),
      practices: practices.map((p) => ({
        id: p.id,
        name: p.name,
        orgId: p.orgId,
        role: p.role,
      })),
      active: activePractice
        ? {
            orgId: activePractice.orgId,
            orgName: activeOrg?.name ?? "",
            practiceId: activePractice.id,
            practiceName: activePractice.name,
            role: activePractice.role,
          }
        : null,
    });
  });

  app.post("/api/session/context", auth, async (req, res) => {
    const parsed = contextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const membership = await storage.getPracticeMembership(
      req.currentUser!.id,
      parsed.data.practiceId,
    );
    const practice = await storage.getPractice(parsed.data.practiceId);
    if (
      !membership ||
      !practice ||
      practice.orgId !== parsed.data.orgId ||
      practice.status !== "active"
    ) {
      return res.status(403).json({ error: "practice_access_denied" });
    }
    req.session.activeOrgId = practice.orgId;
    req.session.activePracticeId = practice.id;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: "session_error" });
      res.json({
        orgId: practice.orgId,
        practiceId: practice.id,
        practiceName: practice.name,
        role: membership.role,
      });
    });
  });

  app.post("/api/organizations", auth, async (req, res) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const org = await storage.createOrganization({ name: parsed.data.name.trim() });
    await storage.createOrgMembership({
      orgId: org.id,
      userId: req.currentUser!.id,
      role: "owner",
    });
    let practice = null;
    if (parsed.data.practiceName) {
      practice = await storage.createPractice({
        orgId: org.id,
        name: parsed.data.practiceName.trim(),
      });
      await storage.createPracticeMembership({
        orgId: org.id,
        practiceId: practice.id,
        userId: req.currentUser!.id,
        role: "owner",
      });
      req.session.activeOrgId = org.id;
      req.session.activePracticeId = practice.id;
    } else {
      req.session.activeOrgId = org.id;
    }
    res.status(201).json({
      organization: { id: org.id, name: org.name },
      practice: practice
        ? { id: practice.id, name: practice.name, orgId: org.id, role: "owner" }
        : null,
    });
  });

  app.post("/api/practices", auth, orgGate, async (req, res) => {
    const parsed = createPracticeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    if (parsed.data.orgId !== req.orgAccess!.orgId) {
      return res.status(403).json({ error: "org_access_denied" });
    }
    const practice = await storage.createPractice({
      orgId: req.orgAccess!.orgId,
      name: parsed.data.name.trim(),
    });
    await storage.createPracticeMembership({
      orgId: req.orgAccess!.orgId,
      practiceId: practice.id,
      userId: req.currentUser!.id,
      role: "owner",
    });
    req.session.activeOrgId = practice.orgId;
    req.session.activePracticeId = practice.id;
    res.status(201).json({
      practice: {
        id: practice.id,
        name: practice.name,
        orgId: practice.orgId,
        role: "owner",
      },
    });
  });

  app.get("/api/practices", auth, async (req, res) => {
    const practices = await storage.listPracticesForUser(req.currentUser!.id);
    res.json({
      practices: practices.map((p) => ({
        id: p.id,
        name: p.name,
        orgId: p.orgId,
        role: p.role,
      })),
    });
  });

  app.get("/api/patients", auth, practiceGate, requireRole(...PHI_READ_ROLES), async (req, res) => {
    const tenant = req.tenant!;
    const rows = await storage.listPatients({
      orgId: tenant.orgId,
      practiceId: tenant.practiceId,
    });
    await logAudit(storage, {
      orgId: tenant.orgId,
      practiceId: tenant.practiceId,
      actorId: req.currentUser!.id,
      action: "list",
      resourceType: "patient",
      metadata: { count: rows.length },
      ipAddress: getClientIp(req),
    });
    res.json({ patients: rows });
  });

  app.post("/api/patients", auth, practiceGate, requireRole(...PHI_WRITE_ROLES), async (req, res) => {
    const parsed = patientWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const tenant = req.tenant!;
    const patient = await storage.createPatient(
      { orgId: tenant.orgId, practiceId: tenant.practiceId },
      parsed.data,
    );
    await logAudit(storage, {
      orgId: tenant.orgId,
      practiceId: tenant.practiceId,
      actorId: req.currentUser!.id,
      action: "create",
      resourceType: "patient",
      resourceId: patient.id,
      metadata: { fields: Object.keys(parsed.data) },
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ patient });
  });

  app.get("/api/patients/:id", auth, practiceGate, requireRole(...PHI_READ_ROLES), async (req, res) => {
    const tenant = req.tenant!;
    const patient = await storage.getPatient(
      { orgId: tenant.orgId, practiceId: tenant.practiceId },
      req.params.id,
    );
    if (!patient) {
      return res.status(404).json({ error: "not_found" });
    }
    await logAudit(storage, {
      orgId: tenant.orgId,
      practiceId: tenant.practiceId,
      actorId: req.currentUser!.id,
      action: "read",
      resourceType: "patient",
      resourceId: patient.id,
      ipAddress: getClientIp(req),
    });
    res.json({ patient });
  });

  app.patch("/api/patients/:id", auth, practiceGate, requireRole(...PHI_WRITE_ROLES), async (req, res) => {
    const parsed = patientPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_input" });
    }
    const tenant = req.tenant!;
    const patient = await storage.updatePatient(
      { orgId: tenant.orgId, practiceId: tenant.practiceId },
      req.params.id,
      parsed.data,
    );
    if (!patient) {
      return res.status(404).json({ error: "not_found" });
    }
    await logAudit(storage, {
      orgId: tenant.orgId,
      practiceId: tenant.practiceId,
      actorId: req.currentUser!.id,
      action: "update",
      resourceType: "patient",
      resourceId: patient.id,
      metadata: { fields: Object.keys(parsed.data) },
      ipAddress: getClientIp(req),
    });
    res.json({ patient });
  });

  app.delete("/api/patients/:id", auth, practiceGate, requireRole(...PHI_DELETE_ROLES), async (req, res) => {
    const tenant = req.tenant!;
    const existing = await storage.getPatient(
      { orgId: tenant.orgId, practiceId: tenant.practiceId },
      req.params.id,
    );
    if (!existing) {
      return res.status(404).json({ error: "not_found" });
    }
    await storage.deletePatient(
      { orgId: tenant.orgId, practiceId: tenant.practiceId },
      req.params.id,
    );
    await logAudit(storage, {
      orgId: tenant.orgId,
      practiceId: tenant.practiceId,
      actorId: req.currentUser!.id,
      action: "delete",
      resourceType: "patient",
      resourceId: req.params.id,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  });

  app.get("/api/import", auth, practiceGate, (_req, res) => {
    const stub = importNotImplemented();
    res.status(stub.status).json(stub.body);
  });

  app.post("/api/import", auth, practiceGate, (_req, res) => {
    const stub = importNotImplemented();
    res.status(stub.status).json(stub.body);
  });

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });
}
