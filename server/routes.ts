import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  PHI_DELETE_ROLES,
  PHI_READ_ROLES,
  PHI_WRITE_ROLES,
} from "@shared/roles";
import { logAudit } from "./audit/logAudit";
import { registerAuthRoutes } from "./auth/http";
import {
  authenticate,
  getClientIp,
  requireOrgAccess,
  requirePracticeMembership,
  requireRole,
} from "./auth/middleware";
import type { HttpContext } from "./http-context";
import { importNotImplemented } from "./import/csv-excel-stub";
import { registerInviteRoutes } from "./invites/http";

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

export function registerRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
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

  registerAuthRoutes(app, ctx);
  registerInviteRoutes(app, ctx);

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
