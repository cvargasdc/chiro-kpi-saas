import type { Express } from "express";
import { z } from "zod";
import {
  MANUAL_METRIC_KEYS,
  buildAnalysisPrompt,
  computeAdvancedMetrics,
  fieldByKey,
  isMonthKey,
  monthToPeriodDate,
} from "@shared/advanced-metrics";
import { toYmd } from "@shared/kpis";
import { monthRange } from "@shared/patients";
import { PHI_READ_ROLES, PHI_WRITE_ROLES } from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import { requireActiveSubscription } from "../billing/entitlement";
import type { HttpContext } from "../http-context";

const monthQuery = z.string().regex(/^\d{4}-\d{2}$/);

const putSchema = z.object({
  month: monthQuery,
  fields: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        value: z.number().finite().nullable().optional(),
        valueNumeric: z.number().finite().nullable().optional(),
        valueText: z.union([z.string().max(500), z.null()]).optional(),
      }),
    )
    .min(1)
    .max(MANUAL_METRIC_KEYS.length),
});

function resolveMonth(raw: unknown, today: string): string | { error: string } {
  if (raw == null || raw === "") return today.slice(0, 7);
  if (typeof raw !== "string" || !isMonthKey(raw)) return { error: "invalid_month" };
  return raw;
}

export function registerAdvancedMetricRoutes(
  app: Express,
  ctx: HttpContext,
): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);
  const billingGate = requireActiveSubscription(ctx);

  async function loadSnapshot(
    scope: { orgId: string; practiceId: string },
    month: string,
  ) {
    const periodMonth = monthToPeriodDate(month);
    const range = monthRange(month);
    const [dailyStats, patients, inputs] = await Promise.all([
      storage.listDailyStats(scope, range),
      storage.listPatients(scope),
      storage.listAdvancedMetricInputs(scope, periodMonth),
    ]);
    return computeAdvancedMetrics({
      month,
      dailyStats,
      patients,
      inputs,
    });
  }

  app.get(
    "/api/advanced-metrics",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const month = resolveMonth(req.query.month, today);
      if (typeof month !== "string") {
        return res.status(400).json({ error: month.error });
      }
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const snapshot = await loadSnapshot(scope, month);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "advanced_metrics",
        resourceId: month,
        metadata: {
          month,
          dailyLogAvailable: snapshot.dailyLogAvailable,
          patientDataAvailable: snapshot.patientDataAvailable,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        today,
        ...snapshot,
        openai: false,
      });
    },
  );

  app.get(
    "/api/advanced-metrics/prompt",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const tenant = req.tenant!;
      const today = toYmd(ctx.now());
      const month = resolveMonth(req.query.month, today);
      if (typeof month !== "string") {
        return res.status(400).json({ error: month.error });
      }
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const snapshot = await loadSnapshot(scope, month);
      const prompt = buildAnalysisPrompt(snapshot);
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "read",
        resourceType: "advanced_metrics_prompt",
        resourceId: month,
        metadata: {
          month,
          aggregatesOnly: true,
          openai: false,
          promptChars: prompt.length,
        },
        ipAddress: getClientIp(req),
      });
      res.json({
        month,
        from: snapshot.from,
        to: snapshot.to,
        prompt,
        aggregatesOnly: true,
        openai: false,
        note: "Local string builder. Paste into any model yourself. This API does not call OpenAI.",
      });
    },
  );

  app.put(
    "/api/advanced-metrics",
    auth,
    practiceGate,
    requireRole(...PHI_WRITE_ROLES),
    billingGate,
    async (req, res) => {
      const parsed = putSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_input" });
      }
      if (!isMonthKey(parsed.data.month)) {
        return res.status(400).json({ error: "invalid_month" });
      }
      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const periodMonth = monthToPeriodDate(parsed.data.month);
      const keys: string[] = [];
      for (const field of parsed.data.fields) {
        const def = fieldByKey(field.key);
        if (!def || !def.writable) {
          return res.status(400).json({
            error: "invalid_field",
            key: field.key,
          });
        }
        const numeric =
          field.valueNumeric !== undefined ? field.valueNumeric : field.value;
        if (numeric != null && numeric < 0) {
          return res.status(400).json({ error: "invalid_value", key: field.key });
        }
        await storage.upsertAdvancedMetricInput(scope, {
          periodMonth,
          section: def.section,
          key: def.key,
          valueNumeric: numeric ?? null,
          valueText: field.valueText ?? null,
          source: "manual",
          updatedBy: req.currentUser!.id,
        });
        keys.push(def.key);
      }
      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "update",
        resourceType: "advanced_metrics",
        resourceId: parsed.data.month,
        metadata: { month: parsed.data.month, keys },
        ipAddress: getClientIp(req),
      });
      const snapshot = await loadSnapshot(scope, parsed.data.month);
      res.json({
        today: toYmd(ctx.now()),
        ...snapshot,
        openai: false,
      });
    },
  );
}
