import type { Express } from "express";
import {
  PeriodRangeError,
  centsToDollars,
  isRevenueWithoutVisits,
  officeVisitAverage,
  percentChange,
  periodEmptyState,
  resolvePeriod,
  roundPercent,
  toYmd,
  type PeriodKey,
} from "@shared/kpis";
import {
  CONVERSION_FORMULA,
  NEW_PATIENT_FORMULA,
  WELLNESS_PATIENT_FORMULA,
  periodFunnel,
} from "@shared/patients";
import { PHI_READ_ROLES } from "@shared/roles";
import { logAudit } from "../audit/logAudit";
import {
  authenticate,
  getClientIp,
  requirePracticeMembership,
  requireRole,
} from "../auth/middleware";
import type { HttpContext } from "../http-context";
import type { StoredDailyStat } from "../storage/types";

const PERIOD_KEYS: PeriodKey[] = ["this_week", "this_month", "custom"];

const PATIENT_KPI_UNAVAILABLE = {
  available: false as const,
  reason:
    "No patients in this practice yet. New-patient and conversion KPIs appear once the first patient is recorded.",
};

function sumVisits(rows: StoredDailyStat[]): number {
  return rows.reduce((sum, row) => sum + row.visits, 0);
}

function sumRevenueCents(rows: StoredDailyStat[]): number {
  return rows.reduce((sum, row) => sum + row.revenueCents, 0);
}

function buildPatientKpis(
  patients: Parameters<typeof periodFunnel>[0],
  from: string,
  to: string,
  previousFrom: string,
  previousTo: string,
) {
  if (patients.length === 0) {
    return {
      newPatients: PATIENT_KPI_UNAVAILABLE,
      wellnessPatients: PATIENT_KPI_UNAVAILABLE,
      conversion: PATIENT_KPI_UNAVAILABLE,
    };
  }
  const current = periodFunnel(patients, from, to);
  const previous = periodFunnel(patients, previousFrom, previousTo);
  return {
    newPatients: {
      available: true as const,
      value: current.newCount,
      previousValue: previous.newCount,
      percentChange: roundPercent(
        percentChange(current.newCount, previous.newCount),
      ),
      percentChangeFormula:
        "((current - previous) / previous) * 100; null when previous is 0 (no baseline)",
      emptyState: current.emptyState,
      unit: "count" as const,
      formula: NEW_PATIENT_FORMULA,
    },
    wellnessPatients: {
      available: true as const,
      value: current.wellnessCount,
      previousValue: previous.wellnessCount,
      percentChange: roundPercent(
        percentChange(current.wellnessCount, previous.wellnessCount),
      ),
      percentChangeFormula:
        "((current - previous) / previous) * 100; null when previous is 0 (no baseline)",
      emptyState:
        current.wellnessCount === 0 && current.newCount === 0
          ? ("no_entries" as const)
          : ("has_data" as const),
      unit: "count" as const,
      formula: WELLNESS_PATIENT_FORMULA,
    },
    conversion: {
      available: true as const,
      value: current.conversionPercent,
      previousValue: previous.conversionPercent,
      percentChange: roundPercent(
        current.conversionPercent != null && previous.conversionPercent != null
          ? percentChange(current.conversionPercent, previous.conversionPercent)
          : null,
      ),
      percentChangeFormula:
        "((current - previous) / previous) * 100; null when either rate is undefined or previous is 0",
      convertedCount: current.convertedCount,
      newCount: current.newCount,
      previousConvertedCount: previous.convertedCount,
      previousNewCount: previous.newCount,
      emptyState: current.emptyState,
      unit: "percent" as const,
      formula: CONVERSION_FORMULA,
    },
  };
}

function kpiBlock(opts: {
  value: number;
  previousValue: number;
  emptyState: ReturnType<typeof periodEmptyState>;
  unit: "count" | "usd";
}) {
  return {
    value: opts.value,
    previousValue: opts.previousValue,
    percentChange: roundPercent(percentChange(opts.value, opts.previousValue)),
    percentChangeFormula:
      "((current - previous) / previous) * 100; null when previous is 0 (no baseline)",
    emptyState: opts.emptyState,
    unit: opts.unit,
  };
}

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
      const [current, previous, patients] = await Promise.all([
        storage.listDailyStats(scope, { from: window.from, to: window.to }),
        storage.listDailyStats(scope, {
          from: window.previousFrom,
          to: window.previousTo,
        }),
        storage.listPatients(scope),
      ]);

      const visits = sumVisits(current);
      const previousVisits = sumVisits(previous);
      const revenueCents = sumRevenueCents(current);
      const previousRevenueCents = sumRevenueCents(previous);
      const ova = officeVisitAverage(revenueCents, visits);
      const previousOva = officeVisitAverage(previousRevenueCents, previousVisits);
      const emptyState = periodEmptyState(current);

      const anomalies = current
        .filter((row) => isRevenueWithoutVisits(row.visits, row.revenueCents))
        .map((row) => ({
          date: row.date,
          visits: row.visits,
          revenue: centsToDollars(row.revenueCents),
          revenueCents: row.revenueCents,
        }));

      const patientKpis = buildPatientKpis(
        patients,
        window.from,
        window.to,
        window.previousFrom,
        window.previousTo,
      );

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

      res.json({
        today,
        period: {
          key: window.key,
          from: window.from,
          to: window.to,
          label: window.label,
          dayCount: window.dayCount,
        },
        comparisonLabel: window.comparisonLabel,
        previousFrom: window.previousFrom,
        previousTo: window.previousTo,
        emptyState,
        emptyStateCopy:
          emptyState === "no_entries"
            ? "No daily log entries in this period yet."
            : emptyState === "zeros_recorded"
              ? "Days were logged, but visits and revenue are all zero."
              : null,
        kpis: {
          visits: kpiBlock({
            value: visits,
            previousValue: previousVisits,
            emptyState,
            unit: "count",
          }),
          revenue: {
            value: centsToDollars(revenueCents),
            previousValue: centsToDollars(previousRevenueCents),
            valueCents: revenueCents,
            previousValueCents: previousRevenueCents,
            percentChange: roundPercent(
              percentChange(revenueCents, previousRevenueCents),
            ),
            percentChangeFormula:
              "((current - previous) / previous) * 100; null when previous is 0 (no baseline). Computed from integer cents.",
            emptyState,
            unit: "usd",
          },
          officeVisitAverage: {
            value: ova,
            previousValue: previousOva,
            percentChange: roundPercent(
              ova != null && previousOva != null
                ? percentChange(ova, previousOva)
                : null,
            ),
            percentChangeFormula:
              "((current - previous) / previous) * 100; null when either OVA is undefined or previous is 0",
            explanation:
              ova == null
                ? "OVA is revenue ÷ visits and is undefined when visits = 0."
                : "OVA = period revenue ÷ period visits (nearest cent).",
            unit: "usd",
          },
          newPatients: patientKpis.newPatients,
          wellnessPatients: patientKpis.wellnessPatients,
          conversion: patientKpis.conversion,
        },
        anomalies: {
          revenueWithoutVisits: anomalies,
        },
      });
    },
  );
}
