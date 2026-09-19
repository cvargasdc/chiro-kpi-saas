import type { Express } from "express";
import { z } from "zod";
import {
  DATE_RE,
  MAX_PERIOD_DAYS,
  inclusiveDayCount,
  isValidYmd,
  startOfIsoWeekMonday,
  toYmd,
} from "@shared/kpis";
import {
  MAX_CHECKLIST_NAME,
  MAX_HISTORY_DAYS,
  MAX_ITEM_CATEGORY,
  MAX_ITEM_TITLE,
  PRACTICE_CHECKLIST_CADENCES,
  buildTodayView,
  completionDateForCadence,
  defaultHistoryRange,
  historyDates,
  isPracticeChecklistCadence,
  normalizeItemCategory,
  type PracticeChecklistCadence,
} from "@shared/practice-checklists";
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
import {
  FEATURE_NOTE,
  publicPracticeChecklist,
  publicPracticeChecklistItem,
} from "./public";

const dateSchema = z
  .string()
  .regex(DATE_RE)
  .refine(isValidYmd, { message: "invalid_date" });

const checklistCreateSchema = z.object({
  name: z.string().min(1).max(MAX_CHECKLIST_NAME),
  cadence: z.enum(PRACTICE_CHECKLIST_CADENCES),
  active: z.boolean().optional(),
});

const checklistPatchSchema = z.object({
  name: z.string().min(1).max(MAX_CHECKLIST_NAME).optional(),
  cadence: z.enum(PRACTICE_CHECKLIST_CADENCES).optional(),
  active: z.boolean().optional(),
});

const itemCreateSchema = z.object({
  title: z.string().min(1).max(MAX_ITEM_TITLE),
  category: z.string().min(1).max(MAX_ITEM_CATEGORY),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});

const itemPatchSchema = z.object({
  title: z.string().min(1).max(MAX_ITEM_TITLE).optional(),
  category: z.string().min(1).max(MAX_ITEM_CATEGORY).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});

const toggleSchema = z.object({
  date: dateSchema.optional(),
  completedOn: dateSchema.optional(),
  completed: z.boolean().optional(),
});

export function registerPracticeChecklistRoutes(
  app: Express,
  ctx: HttpContext,
): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  app.get(
    "/api/practice-checklists/today",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const today = toYmd(ctx.now());
      const rawDate = typeof req.query.date === "string" ? req.query.date : today;
      if (!isValidYmd(rawDate)) {
        return res.status(400).json({ error: "invalid_date" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const [checklists, items, completions] = await Promise.all([
        storage.listPracticeChecklists(scope),
        storage.listPracticeChecklistItems(scope),
        storage.listPracticeChecklistCompletions(scope, {
          from: startOfIsoWeekMonday(rawDate),
          to: rawDate,
        }),
      ]);
      const view = buildTodayView({
        date: rawDate,
        checklists,
        items,
        completions,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "practice_checklist",
        metadata: {
          view: "today",
          date: rawDate,
          count: view.checklists.length,
          done: view.progress.done,
          total: view.progress.total,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        ...view,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.get(
    "/api/practice-checklists/history",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const today = toYmd(ctx.now());
      const defaults = defaultHistoryRange(today);
      const rawFrom =
        typeof req.query.from === "string" ? req.query.from : defaults.from;
      const rawTo = typeof req.query.to === "string" ? req.query.to : defaults.to;
      if (!isValidYmd(rawFrom) || !isValidYmd(rawTo)) {
        return res.status(400).json({ error: "invalid_range" });
      }
      if (rawFrom > rawTo) {
        return res.status(400).json({ error: "from_after_to" });
      }
      const dayCount = inclusiveDayCount(rawFrom, rawTo);
      if (dayCount > Math.min(MAX_PERIOD_DAYS, MAX_HISTORY_DAYS)) {
        return res.status(400).json({ error: "range_too_long" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const [checklists, items, completions] = await Promise.all([
        storage.listPracticeChecklists(scope),
        storage.listPracticeChecklistItems(scope),
        storage.listPracticeChecklistCompletions(scope, {
          from: startOfIsoWeekMonday(rawFrom),
          to: rawTo,
        }),
      ]);
      const days = historyDates(rawFrom, rawTo).map((date) => {
        const view = buildTodayView({
          date,
          checklists,
          items,
          completions,
        });
        return {
          date,
          weekStart: view.weekStart,
          progress: view.progress,
          emptyState: view.emptyState,
        };
      });
      const emptyState =
        checklists.length === 0
          ? "no_checklists"
          : days.every((d) => d.progress.total === 0)
            ? "no_items"
            : "has_data";
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "practice_checklist",
        metadata: {
          view: "history",
          from: rawFrom,
          to: rawTo,
          dayCount,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        from: rawFrom,
        to: rawTo,
        emptyState,
        days,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.get(
    "/api/practice-checklists",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const [checklists, items] = await Promise.all([
        storage.listPracticeChecklists(scope),
        storage.listPracticeChecklistItems(scope),
      ]);
      const grouped = checklists.map((checklist) => ({
        ...publicPracticeChecklist(checklist),
        items: items
          .filter((item) => item.checklistId === checklist.id)
          .map(publicPracticeChecklistItem),
      }));
      const emptyState =
        checklists.length === 0 ? "no_checklists" : "has_data";
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "practice_checklist",
        metadata: { count: checklists.length, itemCount: items.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        emptyState,
        checklists: grouped,
        feature: FEATURE_NOTE,
      });
    },
  );

  app.post(
    "/api/practice-checklists",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = checklistCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = parsed.data.name.trim();
      if (!name) {
        return res.status(400).json({ error: "name_required" });
      }
      const tenant = req.tenant!;
      const row = await storage.createPracticeChecklist(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        {
          name,
          cadence: parsed.data.cadence,
          active: parsed.data.active ?? true,
        },
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "practice_checklist",
        resourceId: row.id,
        metadata: { fields: Object.keys(parsed.data), cadence: row.cadence },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        checklist: publicPracticeChecklist(row),
        feature: FEATURE_NOTE,
      });
    },
  );

  app.get(
    "/api/practice-checklists/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const row = await storage.getPracticeChecklist(scope, req.params.id);
      if (!row) return res.status(404).json({ error: "not_found" });
      const items = await storage.listPracticeChecklistItems(scope, row.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "practice_checklist",
        resourceId: row.id,
        metadata: { fields: ["id"], itemCount: items.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        checklist: {
          ...publicPracticeChecklist(row),
          items: items.map(publicPracticeChecklistItem),
        },
        feature: FEATURE_NOTE,
      });
    },
  );

  app.patch(
    "/api/practice-checklists/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = checklistPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPracticeChecklist(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      let name: string | undefined;
      if (parsed.data.name !== undefined) {
        name = parsed.data.name.trim();
        if (!name) return res.status(400).json({ error: "name_required" });
      }
      const row = await storage.updatePracticeChecklist(scope, existing.id, {
        name,
        cadence: parsed.data.cadence,
        active: parsed.data.active,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "practice_checklist",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ checklist: publicPracticeChecklist(row) });
    },
  );

  app.delete(
    "/api/practice-checklists/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPracticeChecklist(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const deleted = await storage.deletePracticeChecklist(scope, existing.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "practice_checklist",
        resourceId: existing.id,
        metadata: { fields: ["id"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/practice-checklists/:id/items",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = itemCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const title = parsed.data.title.trim();
      if (!title) return res.status(400).json({ error: "title_required" });
      const category = normalizeItemCategory(parsed.data.category);
      if (!category) return res.status(400).json({ error: "category_required" });
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const parent = await storage.getPracticeChecklist(scope, req.params.id);
      if (!parent) return res.status(404).json({ error: "not_found" });
      const row = await storage.createPracticeChecklistItem(scope, {
        checklistId: parent.id,
        title,
        category,
        sortOrder: parsed.data.sortOrder ?? 0,
        active: parsed.data.active ?? true,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "practice_checklist_item",
        resourceId: row.id,
        metadata: {
          fields: Object.keys(parsed.data),
          checklistId: parent.id,
          category: row.category,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({ item: publicPracticeChecklistItem(row) });
    },
  );

  app.patch(
    "/api/practice-checklist-items/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = itemPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const keys = Object.keys(parsed.data);
      if (keys.length === 0) {
        return res.status(400).json({ error: "empty_patch" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPracticeChecklistItem(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      let title: string | undefined;
      if (parsed.data.title !== undefined) {
        title = parsed.data.title.trim();
        if (!title) return res.status(400).json({ error: "title_required" });
      }
      let category: string | undefined;
      if (parsed.data.category !== undefined) {
        category = normalizeItemCategory(parsed.data.category);
        if (!category) return res.status(400).json({ error: "category_required" });
      }
      const row = await storage.updatePracticeChecklistItem(scope, existing.id, {
        title,
        category,
        sortOrder: parsed.data.sortOrder,
        active: parsed.data.active,
      });
      if (!row) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "practice_checklist_item",
        resourceId: row.id,
        metadata: { fields: keys },
        ipAddress: getClientIp(req),
      });
      res.json({ item: publicPracticeChecklistItem(row) });
    },
  );

  app.delete(
    "/api/practice-checklist-items/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getPracticeChecklistItem(scope, req.params.id);
      if (!existing) return res.status(404).json({ error: "not_found" });
      const deleted = await storage.deletePracticeChecklistItem(scope, existing.id);
      if (!deleted) return res.status(404).json({ error: "not_found" });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "practice_checklist_item",
        resourceId: existing.id,
        metadata: { fields: ["id"], checklistId: existing.checklistId },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/practice-checklist-items/:id/toggle",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = toggleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      const today = toYmd(ctx.now());
      const requested = parsed.data.date ?? parsed.data.completedOn ?? today;
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const item = await storage.getPracticeChecklistItem(scope, req.params.id);
      if (!item) return res.status(404).json({ error: "not_found" });
      const parent = await storage.getPracticeChecklist(scope, item.checklistId);
      if (!parent) return res.status(404).json({ error: "not_found" });
      const cadence: PracticeChecklistCadence = isPracticeChecklistCadence(
        parent.cadence,
      )
        ? parent.cadence
        : "daily";
      const completedOn = completionDateForCadence(cadence, requested);
      const existing = await storage.getPracticeChecklistCompletion(
        scope,
        item.id,
        completedOn,
      );
      const completed =
        parsed.data.completed ?? !(existing?.completed ?? false);
      const row = await storage.upsertPracticeChecklistCompletion(scope, {
        itemId: item.id,
        completedOn,
        completed,
        completedBy: req.currentUser!.id,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "practice_checklist_completion",
        resourceId: row.id,
        metadata: {
          fields: ["completed", "completedOn"],
          itemId: item.id,
          completedOn,
          completed,
          cadence,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        completion: {
          id: row.id,
          itemId: row.itemId,
          completedOn: row.completedOn,
          completed: row.completed,
          completedBy: row.completedBy,
        },
      });
    },
  );
}
