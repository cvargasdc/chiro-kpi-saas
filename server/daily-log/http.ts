import type { Express, Request } from "express";
import { z } from "zod";
import {
  DATE_RE,
  MAX_NOTES_LENGTH,
  MAX_PERIOD_DAYS,
  MAX_REVENUE_CENTS,
  MAX_VISITS,
  defaultListRange,
  dollarsToCents,
  inclusiveDayCount,
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
import { DuplicateDailyLogError } from "./errors";
import { dailyLogWarnings, publicDailyLog } from "./public";

const dateParamSchema = z
  .string()
  .regex(DATE_RE)
  .refine(isValidYmd, { message: "invalid_date" });

const revenueDollarsSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_REVENUE_CENTS / 100);

const dailyLogCreateSchema = z
  .object({
    date: dateParamSchema.optional(),
    visits: z.number().int().min(0).max(MAX_VISITS),
    revenue: revenueDollarsSchema.optional(),
    revenueCents: z.number().int().min(0).max(MAX_REVENUE_CENTS).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).optional().nullable(),
  })
  .refine(
    (data) => data.revenue !== undefined || data.revenueCents !== undefined,
    { message: "revenue_required", path: ["revenue"] },
  );

const dailyLogPatchSchema = z
  .object({
    visits: z.number().int().min(0).max(MAX_VISITS).optional(),
    revenue: revenueDollarsSchema.optional(),
    revenueCents: z.number().int().min(0).max(MAX_REVENUE_CENTS).optional(),
    notes: z.string().max(MAX_NOTES_LENGTH).optional().nullable(),
  })
  .refine(
    (data) =>
      data.visits !== undefined ||
      data.revenue !== undefined ||
      data.revenueCents !== undefined ||
      data.notes !== undefined,
    { message: "empty_patch" },
  );

function resolveRevenueCents(input: {
  revenue?: number;
  revenueCents?: number;
}): { ok: true; cents: number } | { ok: false; error: string } {
  if (input.revenueCents !== undefined && input.revenue !== undefined) {
    const fromDollars = dollarsToCents(input.revenue);
    if (fromDollars !== input.revenueCents) {
      return { ok: false, error: "revenue_mismatch" };
    }
    return { ok: true, cents: input.revenueCents };
  }
  if (input.revenueCents !== undefined) {
    return { ok: true, cents: input.revenueCents };
  }
  if (input.revenue !== undefined) {
    return { ok: true, cents: dollarsToCents(input.revenue) };
  }
  return { ok: false, error: "revenue_required" };
}

function parseDateParam(raw: string, today: string): string | null {
  if (raw === "today") return today;
  if (!isValidYmd(raw)) return null;
  return raw;
}

function parseListRange(
  req: Request,
  today: string,
): { from: string; to: string } | { error: string } {
  const fromRaw = typeof req.query.from === "string" ? req.query.from : "";
  const toRaw = typeof req.query.to === "string" ? req.query.to : "";
  if (!fromRaw && !toRaw) {
    return defaultListRange(today);
  }
  const from = fromRaw || defaultListRange(today).from;
  const to = toRaw || today;
  if (!isValidYmd(from) || !isValidYmd(to)) {
    return { error: "invalid_range" };
  }
  if (from > to) {
    return { error: "from_after_to" };
  }
  try {
    if (inclusiveDayCount(from, to) > MAX_PERIOD_DAYS) {
      return { error: "range_too_long" };
    }
  } catch {
    return { error: "invalid_range" };
  }
  return { from, to };
}

export function registerDailyLogRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  app.get(
    "/api/daily-log/today",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const row = await storage.getDailyStatByDate(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        today,
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "daily_log",
        resourceId: today,
        metadata: { helper: "today", found: Boolean(row) },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        entry: row ? publicDailyLog(row) : null,
      });
    },
  );

  app.get(
    "/api/daily-log",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const range = parseListRange(req, today);
      if ("error" in range) {
        return res.status(400).json({ error: range.error });
      }
      const rows = await storage.listDailyStats(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        range,
      );
      const warnings = rows.flatMap((row) =>
        dailyLogWarnings(row.visits, row.revenueCents).map((warning) => ({
          ...warning,
          date: row.date,
        })),
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "daily_log",
        metadata: { count: rows.length },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        from: range.from,
        to: range.to,
        entries: rows.map(publicDailyLog),
        emptyState:
          rows.length === 0
            ? "no_entries"
            : rows.every((row) => row.visits === 0 && row.revenueCents === 0)
              ? "zeros_recorded"
              : "has_data",
        warnings,
      });
    },
  );

  app.get(
    "/api/daily-log/:date",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const date = parseDateParam(req.params.date, today);
      if (!date) {
        return res.status(400).json({ error: "invalid_date" });
      }
      const row = await storage.getDailyStatByDate(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        date,
      );
      if (!row) {
        return res.status(404).json({ error: "not_found" });
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "daily_log",
        resourceId: date,
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        entry: publicDailyLog(row),
        warnings: dailyLogWarnings(row.visits, row.revenueCents),
      });
    },
  );

  app.post(
    "/api/daily-log",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = dailyLogCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const money = resolveRevenueCents(parsed.data);
      if (!money.ok) {
        return res.status(400).json({ error: money.error });
      }
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const date = parsed.data.date ?? today;
      try {
        const row = await storage.createDailyStat(
          { orgId: tenant.orgId, practiceId: tenant.practiceId },
          {
            date,
            visits: parsed.data.visits,
            revenueCents: money.cents,
            notes: parsed.data.notes ?? null,
            createdBy: req.currentUser!.id,
          },
        );
        const warnings = dailyLogWarnings(row.visits, row.revenueCents);
        await logAudit(storage, {
          orgId: tenant.orgId,
          practiceId: tenant.practiceId,
          actorId: req.currentUser!.id,
          action: "create",
          resourceType: "daily_log",
          resourceId: row.id,
          metadata: {
            fields: Object.keys(parsed.data),
            datePresent: true,
            warningCodes: warnings.map((w) => w.code),
          },
          ipAddress: getClientIp(req),
        });
        res.status(201).json({
          today,
          entry: publicDailyLog(row),
          warnings,
        });
      } catch (err) {
        if (err instanceof DuplicateDailyLogError) {
          return res.status(409).json({ error: "duplicate_date", date });
        }
        throw err;
      }
    },
  );

  app.patch(
    "/api/daily-log/:date",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = dailyLogPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.flatten() });
      }
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const date = parseDateParam(req.params.date, today);
      if (!date) {
        return res.status(400).json({ error: "invalid_date" });
      }
      let revenueCents: number | undefined;
      if (
        parsed.data.revenue !== undefined ||
        parsed.data.revenueCents !== undefined
      ) {
        const money = resolveRevenueCents(parsed.data);
        if (!money.ok) {
          return res.status(400).json({ error: money.error });
        }
        revenueCents = money.cents;
      }
      const row = await storage.updateDailyStatByDate(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        date,
        {
          visits: parsed.data.visits,
          revenueCents,
          notes: parsed.data.notes,
        },
      );
      if (!row) {
        return res.status(404).json({ error: "not_found" });
      }
      const warnings = dailyLogWarnings(row.visits, row.revenueCents);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "daily_log",
        resourceId: row.id,
        metadata: {
          fields: Object.keys(parsed.data),
          warningCodes: warnings.map((w) => w.code),
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        entry: publicDailyLog(row),
        warnings,
      });
    },
  );

  app.delete(
    "/api/daily-log/:date",
    auth,
    practiceGate,
    requireRole(...PHI_DELETE_ROLES),
    billingGate,
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const date = parseDateParam(req.params.date, today);
      if (!date) {
        return res.status(400).json({ error: "invalid_date" });
      }
      const existing = await storage.getDailyStatByDate(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        date,
      );
      if (!existing) {
        return res.status(404).json({ error: "not_found" });
      }
      await storage.deleteDailyStatByDate(
        { orgId: tenant.orgId, practiceId: tenant.practiceId },
        date,
      );
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "delete",
        resourceType: "daily_log",
        resourceId: existing.id,
        metadata: { fields: ["date", "visits", "revenue", "notes"] },
        ipAddress: getClientIp(req),
      });
      res.json({ ok: true, today });
    },
  );
}
