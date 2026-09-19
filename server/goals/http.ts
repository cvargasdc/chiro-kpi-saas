import type { Express } from "express";
import { z } from "zod";
import {
  GOAL_METRIC_TYPES,
  GOAL_TIME_PERIODS,
  MAX_GOAL_DAYS,
  MAX_GOAL_NAME,
  MAX_GOAL_NOTES,
  MAX_GOAL_TARGET,
  goalWindowDays,
  isGoalMetricType,
} from "@shared/goals";
import {
  DATE_RE,
  MAX_REVENUE_CENTS,
  dollarsToCents,
  isValidYmd,
  toYmd,
} from "@shared/kpis";
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
import type { StoredDailyStat } from "../storage/types";
import { publicGoal } from "./public";

const dateSchema = z
  .string()
  .regex(DATE_RE)
  .refine(isValidYmd, { message: "invalid_date" });

const metricSchema = z.enum(GOAL_METRIC_TYPES);
const timePeriodSchema = z.enum(GOAL_TIME_PERIODS);

const targetDollarsSchema = z
  .number()
  .finite()
  .gt(0)
  .max(MAX_GOAL_TARGET / 100);

const nativeTargetSchema = z.number().int().positive().max(MAX_GOAL_TARGET);

const goalCreateSchema = z.object({
  name: z.string().min(1).max(MAX_GOAL_NAME).optional(),
  title: z.string().min(1).max(MAX_GOAL_NAME).optional(),
  metricType: metricSchema,
  targetValue: nativeTargetSchema.optional(),
  target: targetDollarsSchema.optional(),
  currentValue: z.number().int().min(0).max(MAX_GOAL_TARGET).optional(),
  current: z.number().finite().min(0).max(MAX_GOAL_TARGET / 100).optional(),
  timePeriod: timePeriodSchema.optional(),
  startDate: dateSchema,
  endDate: dateSchema,
  notes: z.string().max(MAX_GOAL_NOTES).optional().nullable(),
});

const goalPatchSchema = z.object({
  name: z.string().min(1).max(MAX_GOAL_NAME).optional(),
  title: z.string().min(1).max(MAX_GOAL_NAME).optional(),
  metricType: metricSchema.optional(),
  targetValue: nativeTargetSchema.optional(),
  target: targetDollarsSchema.optional(),
  currentValue: z.number().int().min(0).max(MAX_GOAL_TARGET).optional(),
  current: z.number().finite().min(0).max(MAX_GOAL_TARGET / 100).optional(),
  timePeriod: timePeriodSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  notes: z.string().max(MAX_GOAL_NOTES).optional().nullable(),
});

function resolveName(input: { name?: string; title?: string }): string | undefined {
  const raw = input.name ?? input.title;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveNativeTarget(input: {
  metricType: string;
  targetValue?: number;
  target?: number;
}): { ok: true; value: number } | { ok: false; error: string } {
  if (input.metricType === "revenue") {
    if (input.targetValue !== undefined && input.target !== undefined) {
      if (dollarsToCents(input.target) !== input.targetValue) {
        return { ok: false, error: "target_mismatch" };
      }
      return { ok: true, value: input.targetValue };
    }
    if (input.targetValue !== undefined) return { ok: true, value: input.targetValue };
    if (input.target !== undefined) {
      const cents = dollarsToCents(input.target);
      if (cents <= 0 || cents > MAX_GOAL_TARGET) {
        return { ok: false, error: "invalid_target" };
      }
      return { ok: true, value: cents };
    }
    return { ok: false, error: "target_required" };
  }
  if (input.targetValue !== undefined) return { ok: true, value: input.targetValue };
  if (input.target !== undefined) {
    if (!Number.isInteger(input.target) || input.target <= 0) {
      return { ok: false, error: "invalid_target" };
    }
    return { ok: true, value: input.target };
  }
  return { ok: false, error: "target_required" };
}

function resolveManualCurrent(input: {
  metricType: string;
  currentValue?: number;
  current?: number;
}): { ok: true; value: number | null } | { ok: false; error: string } {
  if (input.metricType !== "custom") {
    return { ok: true, value: null };
  }
  if (input.currentValue !== undefined && input.current !== undefined) {
    if (input.currentValue !== input.current) {
      return { ok: false, error: "current_mismatch" };
    }
    return { ok: true, value: input.currentValue };
  }
  if (input.currentValue !== undefined) return { ok: true, value: input.currentValue };
  if (input.current !== undefined) {
    if (!Number.isInteger(input.current) || input.current < 0) {
      return { ok: false, error: "invalid_current" };
    }
    return { ok: true, value: input.current };
  }
  return { ok: true, value: 0 };
}

function validateWindow(startDate: string, endDate: string): string | null {
  if (startDate > endDate) return "from_after_to";
  try {
    if (goalWindowDays(startDate, endDate) > MAX_GOAL_DAYS) {
      return "range_too_long";
    }
  } catch {
    return "invalid_range";
  }
  return null;
}

function statsRange(rows: { startDate: string; endDate: string }[]): {
  from?: string;
  to?: string;
} {
  if (rows.length === 0) return {};
  let from = rows[0].startDate;
  let to = rows[0].endDate;
  for (const row of rows) {
    if (row.startDate < from) from = row.startDate;
    if (row.endDate > to) to = row.endDate;
  }
  return { from, to };
}

export function registerGoalRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  app.get(
    "/api/goals",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const includeExpired =
        typeof req.query.includeExpired === "string" &&
        req.query.includeExpired.toLowerCase() === "true";
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const rows = await storage.listGoals(scope);
      const range = statsRange(rows);
      const stats: StoredDailyStat[] =
        rows.length === 0
          ? []
          : await storage.listDailyStats(scope, range);
      const mapped = rows.map((row) => publicGoal(row, today, stats));
      const expiredCount = mapped.filter((row) => row.status === "expired").length;
      const goals = includeExpired
        ? mapped
        : mapped.filter((row) => row.status !== "expired");

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "goal",
        metadata: {
          count: goals.length,
          expiredCount,
          includeExpired,
        },
        ipAddress: getClientIp(req),
      });

      res.json({
        today,
        includeExpired,
        expiredCount,
        emptyState: mapped.length === 0 ? "no_goals" : "has_data",
        goals,
      });
    },
  );

  app.get(
    "/api/goals/:id",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const row = await storage.getGoal(scope, req.params.id);
      if (!row) {
        return res.status(404).json({ error: "not_found" });
      }
      const stats = await storage.listDailyStats(scope, {
        from: row.startDate,
        to: row.endDate,
      });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "goal",
        resourceId: row.id,
        metadata: { metricType: row.metricType },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        goal: publicGoal(row, today, stats),
      });
    },
  );

  app.post(
    "/api/goals",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = goalCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const name = resolveName(parsed.data);
      if (!name) {
        return res.status(400).json({ error: "name_required" });
      }
      const windowError = validateWindow(parsed.data.startDate, parsed.data.endDate);
      if (windowError) {
        return res.status(400).json({ error: windowError });
      }
      const target = resolveNativeTarget(parsed.data);
      if (!target.ok) {
        return res.status(400).json({ error: target.error });
      }
      const current = resolveManualCurrent(parsed.data);
      if (!current.ok) {
        return res.status(400).json({ error: current.error });
      }
      if (parsed.data.metricType === "revenue" && target.value > MAX_REVENUE_CENTS * 100) {
        return res.status(400).json({ error: "invalid_target" });
      }

      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const row = await storage.createGoal(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        {
          name,
          metricType: parsed.data.metricType,
          targetValue: target.value,
          currentValue: current.value,
          timePeriod: parsed.data.timePeriod ?? "custom",
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          notes: parsed.data.notes ?? null,
          createdBy: req.currentUser!.id,
        },
      );
      const stats =
        parsed.data.metricType === "custom"
          ? []
          : await storage.listDailyStats(
              { orgId: tenant.orgId, practiceId: tenant.practiceId },
              { from: row.startDate, to: row.endDate },
            );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "create",
        resourceType: "goal",
        resourceId: row.id,
        metadata: {
          fields: Object.keys(parsed.data),
          metricType: row.metricType,
        },
        ipAddress: getClientIp(req),
      });
      res.status(201).json({
        today,
        goal: publicGoal(row, today, stats),
      });
    },
  );

  app.patch(
    "/api/goals/:id",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = goalPatchSchema.safeParse(req.body);
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
      const today = toYmd(ctx.now());
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getGoal(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }

      const metricType = parsed.data.metricType ?? existing.metricType;
      if (!isGoalMetricType(metricType)) {
        return res.status(400).json({ error: "invalid_metric_type" });
      }
      const startDate = parsed.data.startDate ?? existing.startDate;
      const endDate = parsed.data.endDate ?? existing.endDate;
      const windowError = validateWindow(startDate, endDate);
      if (windowError) {
        return res.status(400).json({ error: windowError });
      }

      let targetValue: number | undefined;
      if (parsed.data.targetValue !== undefined || parsed.data.target !== undefined) {
        const target = resolveNativeTarget({
          metricType,
          targetValue: parsed.data.targetValue,
          target: parsed.data.target,
        });
        if (!target.ok) {
          return res.status(400).json({ error: target.error });
        }
        targetValue = target.value;
      }

      let currentValue: number | null | undefined;
      if (metricType !== "custom") {
        currentValue = null;
      } else if (
        parsed.data.currentValue !== undefined ||
        parsed.data.current !== undefined
      ) {
        const current = resolveManualCurrent({
          metricType,
          currentValue: parsed.data.currentValue,
          current: parsed.data.current,
        });
        if (!current.ok) {
          return res.status(400).json({ error: current.error });
        }
        currentValue = current.value;
      }

      const name = resolveName(parsed.data);
      const row = await storage.updateGoal(scope, req.params.id, {
        name,
        metricType: parsed.data.metricType,
        targetValue,
        currentValue,
        timePeriod: parsed.data.timePeriod,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        notes: parsed.data.notes,
      });
      if (!row) {
        return res.status(404).json({ error: "not_found" });
      }
      const stats =
        row.metricType === "custom"
          ? []
          : await storage.listDailyStats(scope, {
              from: row.startDate,
              to: row.endDate,
            });
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "goal",
        resourceId: row.id,
        metadata: {
          fields: keys,
          metricType: row.metricType,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        goal: publicGoal(row, today, stats),
      });
    },
  );

  app.delete(
    "/api/goals/:id",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const existing = await storage.getGoal(scope, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      await storage.deleteGoal(scope, req.params.id);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "goal",
        resourceId: existing.id,
        metadata: {
          fields: ["name", "metricType", "targetValue", "startDate", "endDate", "notes"],
          metricType: existing.metricType,
        },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true });
    },
  );
}
