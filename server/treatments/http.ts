import type { Express } from "express";
import { z } from "zod";
import {
  PHI_DELETE_ROLES,
  PHI_READ_ROLES,
  PHI_WRITE_ROLES,
} from "@shared/roles";
import {
  CARE_PLAN_GENERATOR,
  MAX_PRICE_CENTS,
  MAX_SORT_ORDER,
  MAX_TREATMENT_CATEGORY,
  MAX_TREATMENT_DESCRIPTION,
  MAX_TREATMENT_NAME,
  MIN_SORT_ORDER,
  groupByCategory,
  normalizeCategory,
  resolvePriceCents,
} from "@shared/treatments";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import { requireActiveSubscription } from "../billing/entitlement";
import type { HttpContext } from "../http-context";
import { publicTreatment } from "./public";

const priceDollarsSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_PRICE_CENTS / 100);

const treatmentCreateSchema = z.object({
  name: z.string().min(1).max(MAX_TREATMENT_NAME),
  description: z
    .union([z.string().max(MAX_TREATMENT_DESCRIPTION), z.null()])
    .optional(),
  category: z.string().min(1).max(MAX_TREATMENT_CATEGORY),
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).optional(),
  price: priceDollarsSchema.optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(MIN_SORT_ORDER).max(MAX_SORT_ORDER).optional(),
});

const treatmentPatchSchema = z.object({
  name: z.string().min(1).max(MAX_TREATMENT_NAME).optional(),
  description: z
    .union([z.string().max(MAX_TREATMENT_DESCRIPTION), z.null()])
    .optional(),
  category: z.string().min(1).max(MAX_TREATMENT_CATEGORY).optional(),
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).optional(),
  price: priceDollarsSchema.optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(MIN_SORT_ORDER).max(MAX_SORT_ORDER).optional(),
});

function parseActiveQuery(raw: unknown): boolean | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

export function registerTreatmentRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  app.get(
    "/api/treatments",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rows = await storage.listTreatments(scope);
      const activeFilter = parseActiveQuery(req.query.active);
      const filtered =
        activeFilter === undefined
          ? rows
          : rows.filter((row) => row.active === activeFilter);
      const treatments = filtered.map(publicTreatment);
      const emptyState =
        rows.length === 0
          ? "no_treatments"
          : treatments.length === 0
            ? "no_matches"
            : "has_data";

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "treatment",
        metadata: {
          count: treatments.length,
          total: rows.length,
          activeFilter: activeFilter ?? null,
        },
        ipAddress: getClientIp(req),
      });

      res.json({
        emptyState,
        treatments,
        grouped: groupByCategory(treatments),
        carePlanGenerator: CARE_PLAN_GENERATOR,
      });
    },
  );

  app.get(
    "/api/treatments/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const row = await storage.getTreatment(scope, req.params.id);
      if (!row) {
        return res.status(404).json({ error: "not_found" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "treatment",
        resourceId: row.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({
        treatment: publicTreatment(row),
        carePlanGenerator: CARE_PLAN_GENERATOR,
      });
    },
  );

  app.post(
    "/api/treatments",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = treatmentCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = parsed.data.name.trim();
      if (!name) {
        return res.status(400).json({ error: "name_required" });
      }
      const category = normalizeCategory(parsed.data.category);
      if (!category) {
        return res.status(400).json({ error: "category_required" });
      }
      const price = resolvePriceCents(parsed.data);
      if (!price.ok) {
        return res.status(400).json({ error: price.error });
      }

      const tenant = req.tenant!;
      const row = await storage.createTreatment(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        {
          name,
          description:
            parsed.data.description === undefined
              ? null
              : parsed.data.description === null
                ? null
                : parsed.data.description.trim() || null,
          category,
          priceCents: price.cents,
          active: parsed.data.active ?? true,
          sortOrder: parsed.data.sortOrder ?? 0,
        },
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "treatment",
        resourceId: row.id,
        metadata: {
          fields: Object.keys(parsed.data),
          category: row.category,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ treatment: publicTreatment(row) });
    },
  );

  app.patch(
    "/api/treatments/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = treatmentPatchSchema.safeParse(req.body);
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
      const existing = await storage.getTreatment(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }

      let category: string | undefined;
      if (parsed.data.category !== undefined) {
        const normalized = normalizeCategory(parsed.data.category);
        if (!normalized) {
          return res.status(400).json({ error: "category_required" });
        }
        category = normalized;
      }

      let priceCents: number | undefined;
      if (
        parsed.data.priceCents !== undefined ||
        parsed.data.price !== undefined
      ) {
        const price = resolvePriceCents({
          priceCents: parsed.data.priceCents,
          price: parsed.data.price,
        });
        if (!price.ok) {
          return res.status(400).json({ error: price.error });
        }
        priceCents = price.cents;
      }

      let name: string | undefined;
      if (parsed.data.name !== undefined) {
        name = parsed.data.name.trim();
        if (!name) {
          return res.status(400).json({ error: "name_required" });
        }
      }

      let description: string | null | undefined;
      if (parsed.data.description !== undefined) {
        description =
          parsed.data.description === null
            ? null
            : parsed.data.description.trim() || null;
      }

      const row = await storage.updateTreatment(scope, existing.id, {
        name,
        description,
        category,
        priceCents,
        active: parsed.data.active,
        sortOrder: parsed.data.sortOrder,
      });
      if (!row) {
        return res.status(404).json({ error: "not_found" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "treatment",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ treatment: publicTreatment(row) });
    },
  );

  app.delete(
    "/api/treatments/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getTreatment(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      const deleted = await storage.deleteTreatment(scope, existing.id);
      if (!deleted) {
        return res.status(404).json({ error: "not_found" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "treatment",
        resourceId: existing.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );
}
