import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  DEFAULT_CARE_PLAN_TERMS,
  DEFAULT_COMPLIANCE_NOTICE,
  MAX_CARE_PLAN_NAME,
  MAX_CARE_PLAN_NOTES,
  MAX_TEMPLATE_NAME,
  isCarePlanStatus,
  normalizePaymentSettings,
  normalizeTreatmentSelections,
  snapshotSelections,
} from "@shared/care-plans";
import {
  PHI_DELETE_ROLES,
  PHI_READ_ROLES,
  PHI_WRITE_ROLES,
} from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import { requireActiveSubscription } from "../billing/entitlement";
import type { HttpContext } from "../http-context";
import { publicCarePlan, publicCarePlanTemplate } from "./public";
import { renderCarePlanPdf } from "./pdf";

const createPlanSchema = z.object({
  firstName: z.string().min(1).max(MAX_CARE_PLAN_NAME),
  lastName: z.string().min(1).max(MAX_CARE_PLAN_NAME),
  notes: z.union([z.string().max(MAX_CARE_PLAN_NOTES), z.null()]).optional(),
  patientId: z.union([z.string().min(1), z.null()]).optional(),
  treatmentSelections: z.unknown().optional(),
  selections: z.unknown().optional(),
  paymentSettings: z.unknown().optional(),
  status: z.string().optional(),
  saveAsTemplate: z.boolean().optional(),
  templateName: z.string().max(MAX_TEMPLATE_NAME).optional(),
});

const patchPlanSchema = z.object({
  firstName: z.string().min(1).max(MAX_CARE_PLAN_NAME).optional(),
  lastName: z.string().min(1).max(MAX_CARE_PLAN_NAME).optional(),
  notes: z.union([z.string().max(MAX_CARE_PLAN_NOTES), z.null()]).optional(),
  patientId: z.union([z.string().min(1), z.null()]).optional(),
  treatmentSelections: z.unknown().optional(),
  selections: z.unknown().optional(),
  paymentSettings: z.unknown().optional(),
  status: z.string().optional(),
});

const templateCreateSchema = z.object({
  name: z.string().min(1).max(MAX_TEMPLATE_NAME),
  defaultSelections: z.unknown().optional(),
  treatmentSelections: z.unknown().optional(),
  paymentSettings: z.unknown().optional(),
  active: z.boolean().optional(),
});

const templatePatchSchema = z.object({
  name: z.string().min(1).max(MAX_TEMPLATE_NAME).optional(),
  defaultSelections: z.unknown().optional(),
  treatmentSelections: z.unknown().optional(),
  paymentSettings: z.unknown().optional(),
  active: z.boolean().optional(),
});

function complianceDenied(res: Response) {
  return res.status(403).json({
    error: "compliance_required",
    code: "compliance_required",
  });
}

function requireCarePlanAck(ctx: HttpContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const tenant = req.tenant!;
    const user = req.currentUser!;
    const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
    if (req.session.carePlanComplianceAcknowledgedAt) {
      return next();
    }
    const stored = await ctx.storage.getCarePlanComplianceAck(scope, user.id);
    if (stored) {
      req.session.carePlanComplianceAcknowledgedAt =
        stored.acknowledgedAt.toISOString();
      return next();
    }
    return complianceDenied(res);
  };
}

export function registerCarePlanRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);
  const ackGate = requireCarePlanAck(ctx);

  app.get(
    "/api/care-plans/compliance",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const settings = await storage.getPracticeSettings(scope);
      const stored = await storage.getCarePlanComplianceAck(
        scope,
        req.currentUser!.id,
      );
      const sessionAt = req.session.carePlanComplianceAcknowledgedAt ?? null;
      if (!sessionAt && stored) {
        req.session.carePlanComplianceAcknowledgedAt =
          stored.acknowledgedAt.toISOString();
      }
      const acknowledgedAt =
        sessionAt ?? (stored ? stored.acknowledgedAt.toISOString() : null);
      const source = sessionAt ? "session" : stored ? "stored" : null;

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "care_plan_compliance",
        metadata: {
          acknowledged: Boolean(acknowledgedAt),
          source,
        },
        ipAddress: getClientIp(req),
      });

      res.json({
        notice: settings?.complianceNotice?.trim() || DEFAULT_COMPLIANCE_NOTICE,
        terms: settings?.carePlanTerms ?? null,
        acknowledged: Boolean(acknowledgedAt),
        acknowledgedAt,
        source,
      });
    },
  );

  app.post(
    "/api/care-plans/compliance/acknowledge",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const user = req.currentUser!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const at = ctx.now();
      const stored = await storage.upsertCarePlanComplianceAck(
        scope,
        user.id,
        at,
      );
      req.session.carePlanComplianceAcknowledgedAt = stored.acknowledgedAt.toISOString();

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: user.id,
        action: "acknowledge",
        resourceType: "care_plan_compliance",
        resourceId: stored.id,
        metadata: { fields: ["acknowledgedAt"] },
        ipAddress: getClientIp(req),
      });

      res.json({
        acknowledged: true,
        acknowledgedAt: stored.acknowledgedAt.toISOString(),
        source: "stored",
      });
    },
  );

  app.get(
    "/api/care-plan-templates",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rows = await storage.listCarePlanTemplates(scope);
      const activeFilter =
        typeof req.query.active === "string"
          ? req.query.active === "true" || req.query.active === "1"
            ? true
            : req.query.active === "false" || req.query.active === "0"
              ? false
              : undefined
          : undefined;
      const filtered =
        activeFilter === undefined
          ? rows
          : rows.filter((row) => row.active === activeFilter);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "care_plan_template",
        metadata: { count: filtered.length, total: rows.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        emptyState: rows.length === 0 ? "no_templates" : "has_data",
        templates: filtered.map(publicCarePlanTemplate),
      });
    },
  );

  app.post(
    "/api/care-plan-templates",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    ackGate,
    async (req, res) => {
      const parsed = templateCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = parsed.data.name.trim();
      if (!name) return res.status(400).json({ error: "name_required" });
      const rawSelections =
        parsed.data.defaultSelections ??
        {
          treatmentSelections:
            parsed.data.treatmentSelections ?? parsed.data.defaultSelections,
          paymentSettings: parsed.data.paymentSettings,
        };
      const obj =
        rawSelections && typeof rawSelections === "object"
          ? (rawSelections as Record<string, unknown>)
          : {};
      const selections = normalizeTreatmentSelections(
        obj.treatmentSelections ?? parsed.data.treatmentSelections ?? obj,
      );
      if (!selections.ok) {
        return res.status(400).json({ error: selections.error });
      }
      const payment = normalizePaymentSettings(
        obj.paymentSettings ?? parsed.data.paymentSettings,
      );
      if (!payment.ok) {
        return res.status(400).json({ error: payment.error });
      }
      const tenant = req.tenant!;
      const row = await storage.createCarePlanTemplate(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        {
          name,
          defaultSelections: {
            treatmentSelections: selections.selections,
            paymentSettings: payment.settings,
          },
          active: parsed.data.active ?? true,
        },
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "care_plan_template",
        resourceId: row.id,
        metadata: { fields: ["name", "defaultSelections"] },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ template: publicCarePlanTemplate(row) });
    },
  );

  app.get(
    "/api/care-plan-templates/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const row = await storage.getCarePlanTemplate(scope, req.params.id);
      if (!row) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "care_plan_template",
        resourceId: row.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ template: publicCarePlanTemplate(row) });
    },
  );

  app.patch(
    "/api/care-plan-templates/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    ackGate,
    async (req, res) => {
      const parsed = templatePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getCarePlanTemplate(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });

      let defaultSelections = existing.defaultSelections;
      if (
        parsed.data.defaultSelections !== undefined ||
        parsed.data.treatmentSelections !== undefined ||
        parsed.data.paymentSettings !== undefined
      ) {
        const obj =
          parsed.data.defaultSelections &&
          typeof parsed.data.defaultSelections === "object"
            ? (parsed.data.defaultSelections as Record<string, unknown>)
            : {};
        const selections = normalizeTreatmentSelections(
          obj.treatmentSelections ??
            parsed.data.treatmentSelections ??
            existing.defaultSelections.treatmentSelections,
        );
        if (!selections.ok) {
          return res.status(400).json({ error: selections.error });
        }
        const payment = normalizePaymentSettings(
          obj.paymentSettings ??
            parsed.data.paymentSettings ??
            existing.defaultSelections.paymentSettings,
        );
        if (!payment.ok) {
          return res.status(400).json({ error: payment.error });
        }
        defaultSelections = {
          treatmentSelections: selections.selections,
          paymentSettings: payment.settings,
        };
      }

      let name: string | undefined;
      if (parsed.data.name !== undefined) {
        name = parsed.data.name.trim();
        if (!name) return res.status(400).json({ error: "name_required" });
      }

      const row = await storage.updateCarePlanTemplate(scope, existing.id, {
        name,
        defaultSelections,
        active: parsed.data.active,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "care_plan_template",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ template: publicCarePlanTemplate(row) });
    },
  );

  app.delete(
    "/api/care-plan-templates/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    ackGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getCarePlanTemplate(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const deleted = await storage.deleteCarePlanTemplate(scope, existing.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "care_plan_template",
        resourceId: existing.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.get(
    "/api/care-plans",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const [rows, catalog] = await Promise.all([
        storage.listCarePlans(scope),
        storage.listTreatments(scope),
      ]);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "care_plan",
        metadata: { count: rows.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        emptyState: rows.length === 0 ? "no_plans" : "has_data",
        carePlans: rows.map((row) => publicCarePlan(row, catalog)),
      });
    },
  );

  app.post(
    "/api/care-plans",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    ackGate,
    async (req, res) => {
      const parsed = createPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const firstName = parsed.data.firstName.trim();
      const lastName = parsed.data.lastName.trim();
      if (!firstName || !lastName) {
        return res.status(400).json({ error: "name_required" });
      }
      const selections = normalizeTreatmentSelections(
        parsed.data.treatmentSelections ?? parsed.data.selections,
      );
      if (!selections.ok) {
        return res.status(400).json({ error: selections.error });
      }
      if (selections.selections.length === 0) {
        return res.status(400).json({ error: "treatments_required" });
      }
      const payment = normalizePaymentSettings(parsed.data.paymentSettings);
      if (!payment.ok) {
        return res.status(400).json({ error: payment.error });
      }
      let status: "draft" | "final" = "draft";
      if (parsed.data.status !== undefined) {
        if (!isCarePlanStatus(parsed.data.status)) {
          return res.status(400).json({ error: "invalid_status" });
        }
        status = parsed.data.status;
      }

      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const catalog = await storage.listTreatments(scope);
      const snapped = snapshotSelections(selections.selections, catalog);
      if (!snapped.ok) {
        return res.status(400).json({
          error: snapped.error,
          treatmentId: snapped.treatmentId,
        });
      }

      let patientId: string | null = parsed.data.patientId ?? null;
      if (patientId) {
        const patient = await storage.getPatient(scope, patientId);
        if (!patient) return res.status(400).json({ error: "unknown_patient" });
      }

      let templateName: string | null = null;
      if (parsed.data.saveAsTemplate) {
        templateName = (parsed.data.templateName ?? "").trim();
        if (!templateName) {
          return res.status(400).json({ error: "template_name_required" });
        }
      }

      const ackAt = req.session.carePlanComplianceAcknowledgedAt
        ? new Date(req.session.carePlanComplianceAcknowledgedAt)
        : ctx.now();
      const row = await storage.createCarePlan(scope, {
        patientId,
        firstName,
        lastName,
        notes:
          parsed.data.notes === undefined
            ? null
            : parsed.data.notes === null
              ? null
              : parsed.data.notes.trim() || null,
        treatmentSelections: snapped.selections,
        paymentSettings: payment.settings,
        subtotalCents: snapped.subtotalCents,
        status,
        complianceAcknowledgedAt: ackAt,
        complianceAcknowledgedBy: req.currentUser!.id,
        createdBy: req.currentUser!.id,
      });

      let template = null;
      if (templateName) {
        template = await storage.createCarePlanTemplate(scope, {
          name: templateName,
          defaultSelections: {
            treatmentSelections: snapped.selections,
            paymentSettings: payment.settings,
          },
          active: true,
        });
        await logAudit(storage, {
          orgId: tenant.orgId,
          practiceId: tenant.practiceId,
          actorId: req.currentUser!.id,
          action: "create",
          resourceType: "care_plan_template",
          resourceId: template.id,
          metadata: { fields: ["name", "defaultSelections"], fromCarePlan: true },
          ipAddress: getClientIp(req),
        });
      }

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "care_plan",
        resourceId: row.id,
        metadata: {
          fields: Object.keys(parsed.data).filter(
            (key) => key !== "firstName" && key !== "lastName" && key !== "notes",
          ),
          status: row.status,
          selectionCount: snapped.selections.length,
          subtotalCents: row.subtotalCents,
        },
        ipAddress: getClientIp(req),
      });

      res.status(201).json({
        carePlan: publicCarePlan(row, catalog),
        template: template ? publicCarePlanTemplate(template) : null,
      });
    },
  );

  app.get(
    "/api/care-plans/:id/export.pdf",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    ackGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const row = await storage.getCarePlan(scope, req.params.id);
      if (!row) return res.status(404).json({ error: "not_found" });
      const [catalog, settings, practice] = await Promise.all([
        storage.listTreatments(scope),
        storage.getPracticeSettings(scope),
        storage.getPractice(tenant.practiceId),
      ]);
      const pub = publicCarePlan(row, catalog);
      const pdf = await renderCarePlanPdf({
        practiceName: practice?.name ?? "Practice",
        firstName: pub.firstName,
        lastName: pub.lastName,
        notes: pub.notes,
        lineItems: pub.lineItems,
        subtotalCents: pub.subtotalCents,
        subtotalDisplay: pub.subtotalDisplay,
        paymentSettings: pub.paymentSettings,
        paymentQuotes: pub.paymentQuotes,
        terms: settings?.carePlanTerms?.trim() || DEFAULT_CARE_PLAN_TERMS,
        status: pub.status,
        primaryColor: practice?.primaryColor ?? null,
        logoUrl: practice?.logoUrl ?? null,
      });

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "export",
        resourceType: "care_plan",
        resourceId: row.id,
        metadata: { format: "pdf", bytes: pdf.length, fields: ["id"] },
        ipAddress: getClientIp(req),
      });

      const filename = `care-plan-${row.id}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    },
  );

  app.get(
    "/api/care-plans/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const row = await storage.getCarePlan(scope, req.params.id);
      if (!row) return res.status(404).json({ error: "not_found" });
      const catalog = await storage.listTreatments(scope);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "care_plan",
        resourceId: row.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ carePlan: publicCarePlan(row, catalog) });
    },
  );

  app.patch(
    "/api/care-plans/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    ackGate,
    async (req, res) => {
      const parsed = patchPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getCarePlan(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });

      const catalog = await storage.listTreatments(scope);
      let treatmentSelections = existing.treatmentSelections;
      let subtotalCents = existing.subtotalCents;
      if (
        parsed.data.treatmentSelections !== undefined ||
        parsed.data.selections !== undefined
      ) {
        const selections = normalizeTreatmentSelections(
          parsed.data.treatmentSelections ?? parsed.data.selections,
        );
        if (!selections.ok) {
          return res.status(400).json({ error: selections.error });
        }
        if (selections.selections.length === 0) {
          return res.status(400).json({ error: "treatments_required" });
        }
        const snapped = snapshotSelections(selections.selections, catalog);
        if (!snapped.ok) {
          return res.status(400).json({
            error: snapped.error,
            treatmentId: snapped.treatmentId,
          });
        }
        treatmentSelections = snapped.selections;
        subtotalCents = snapped.subtotalCents;
      } else {
        const snapped = snapshotSelections(existing.treatmentSelections, catalog);
        if (snapped.ok) {
          treatmentSelections = snapped.selections;
          subtotalCents = snapped.subtotalCents;
        }
      }

      let paymentSettings = existing.paymentSettings;
      if (parsed.data.paymentSettings !== undefined) {
        const payment = normalizePaymentSettings(parsed.data.paymentSettings);
        if (!payment.ok) {
          return res.status(400).json({ error: payment.error });
        }
        paymentSettings = payment.settings;
      }

      let status = existing.status;
      if (parsed.data.status !== undefined) {
        if (!isCarePlanStatus(parsed.data.status)) {
          return res.status(400).json({ error: "invalid_status" });
        }
        status = parsed.data.status;
      }

      let firstName: string | undefined;
      if (parsed.data.firstName !== undefined) {
        firstName = parsed.data.firstName.trim();
        if (!firstName) return res.status(400).json({ error: "name_required" });
      }
      let lastName: string | undefined;
      if (parsed.data.lastName !== undefined) {
        lastName = parsed.data.lastName.trim();
        if (!lastName) return res.status(400).json({ error: "name_required" });
      }
      let notes: string | null | undefined;
      if (parsed.data.notes !== undefined) {
        notes =
          parsed.data.notes === null ? null : parsed.data.notes.trim() || null;
      }

      let patientId: string | null | undefined = parsed.data.patientId;
      if (patientId) {
        const patient = await storage.getPatient(scope, patientId);
        if (!patient) return res.status(400).json({ error: "unknown_patient" });
      }

      const row = await storage.updateCarePlan(scope, existing.id, {
        patientId,
        firstName,
        lastName,
        notes,
        treatmentSelections,
        paymentSettings,
        subtotalCents,
        status,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "care_plan",
        resourceId: row.id,
        metadata: {
          fields: keys.filter(
            (key) => key !== "firstName" && key !== "lastName" && key !== "notes",
          ),
          status: row.status,
          subtotalCents: row.subtotalCents,
        },
        ipAddress: getClientIp(req),
      });
      res.json({ carePlan: publicCarePlan(row, catalog) });
    },
  );

  app.delete(
    "/api/care-plans/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    ackGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getCarePlan(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const deleted = await storage.deleteCarePlan(scope, existing.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "care_plan",
        resourceId: existing.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );
}
