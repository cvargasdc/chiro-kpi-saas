import type { Express } from "express";
import { PeriodRangeError, resolvePeriod, toYmd, type PeriodKey } from "@shared/kpis";
import { PHI_READ_ROLES } from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import type { HttpContext } from "../http-context";
import { summarizeOnboardingProgress } from "@shared/onboarding";
import { buildDashboardSnapshot } from "./compute";

const PERIOD_KEYS: PeriodKey[] = ["this_week", "this_month", "custom"];

export function registerDashboardRoutes(app: Express, ctx: HttpContext): void {
  const storage = ctx.storage;
  const auth = authenticate(storage);
  const practiceGate = requirePracticeMembership(storage);

  app.get(
    "/api/dashboard",
    auth,
    practiceGate,
    requireRole(...PHI_READ_ROLES),
    async (req, res) => {
      const rawPeriod =
        typeof req.query.period === "string" ? req.query.period : "this_week";
      if (!PERIOD_KEYS.includes(rawPeriod as PeriodKey)) {
        return res.status(400).json({ error: "invalid_period" });
      }
      const periodKey = rawPeriod as PeriodKey;
      const today = toYmd(ctx.now());
      let window;
      try {
        window = resolvePeriod({
          period: periodKey,
          today,
          from: typeof req.query.from === "string" ? req.query.from : undefined,
          to: typeof req.query.to === "string" ? req.query.to : undefined,
        });
      } catch (err) {
        if (err instanceof PeriodRangeError) {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }

      const tenant = req.tenant!;
      const scope = { orgId: tenant.orgId, practiceId: tenant.practiceId };
      const [current, previous, patients, patientChecklists] = await Promise.all([
        storage.listDailyStats(scope, { from: window.from, to: window.to }),
        storage.listDailyStats(scope, {
          from: window.previousFrom,
          to: window.previousTo,
        }),
        storage.listPatients(scope),
        storage.listPatientChecklists(scope),
      ]);

      const snapshot = buildDashboardSnapshot({
        today,
        window,
        current,
        previous,
        patients,
      });
      const onboarding = summarizeOnboardingProgress(patientChecklists);

      await logAudit(storage, {
        orgId: tenant.orgId,
        practiceId: tenant.practiceId,
        actorId: req.currentUser!.id,
        action: "list",
        resourceType: "dashboard",
        metadata: {
          period: window.key,
          currentCount: current.length,
        },
        ipAddress: getClientIp(req),
      });

      res.json({ ...snapshot, onboarding });
    },
  );
}
