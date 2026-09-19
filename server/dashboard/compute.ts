import {
  centsToDollars,
  isRevenueWithoutVisits,
  officeVisitAverage,
  percentChange,
  periodEmptyState,
  roundPercent,
  type EmptyState,
} from "@shared/kpis";
import {
  CONVERSION_FORMULA,
  NEW_PATIENT_FORMULA,
  WELLNESS_PATIENT_FORMULA,
  periodFunnel,
} from "@shared/patients";
import type { StoredDailyStat, StoredPatient } from "../storage/types";

const PATIENT_KPI_UNAVAILABLE = {
  available: false as const,
  reason:
    "No patients in this practice yet. New-patient and conversion KPIs appear once the first patient is recorded.",
};

export type DashboardWindow = {
  key: string;
  from: string;
  to: string;
  label: string;
  dayCount: number;
  comparisonLabel: string;
  previousFrom: string;
  previousTo: string;
};

export type DashboardSnapshot = {
  today: string;
  period: {
    key: string;
    from: string;
    to: string;
    label: string;
    dayCount: number;
  };
  comparisonLabel: string;
  previousFrom: string;
  previousTo: string;
  emptyState: EmptyState;
  emptyStateCopy: string | null;
  kpis: {
    visits: ReturnType<typeof kpiBlock>;
    revenue: {
      value: number;
      previousValue: number;
      valueCents: number;
      previousValueCents: number;
      percentChange: number | null;
      percentChangeFormula: string;
      emptyState: EmptyState;
      unit: "usd";
    };
    officeVisitAverage: {
      value: number | null;
      previousValue: number | null;
      percentChange: number | null;
      percentChangeFormula: string;
      explanation: string;
      unit: "usd";
    };
    newPatients: ReturnType<typeof buildPatientKpis>["newPatients"];
    wellnessPatients: ReturnType<typeof buildPatientKpis>["wellnessPatients"];
    conversion: ReturnType<typeof buildPatientKpis>["conversion"];
  };
  anomalies: {
    revenueWithoutVisits: Array<{
      date: string;
      visits: number;
      revenue: number;
      revenueCents: number;
    }>;
  };
};

export function sumVisits(rows: StoredDailyStat[]): number {
  return rows.reduce((sum, row) => sum + row.visits, 0);
}

export function sumRevenueCents(rows: StoredDailyStat[]): number {
  return rows.reduce((sum, row) => sum + row.revenueCents, 0);
}

function buildPatientKpis(
  patients: StoredPatient[],
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
  emptyState: EmptyState;
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

export function emptyStateCopy(emptyState: EmptyState): string | null {
  if (emptyState === "no_entries") {
    return "No daily log entries in this period yet.";
  }
  if (emptyState === "zeros_recorded") {
    return "Days were logged, but visits and revenue are all zero.";
  }
  return null;
}

export function buildDashboardSnapshot(opts: {
  today: string;
  window: DashboardWindow;
  current: StoredDailyStat[];
  previous: StoredDailyStat[];
  patients: StoredPatient[];
}): DashboardSnapshot {
  const { today, window, current, previous, patients } = opts;
  const visits = sumVisits(current);
  const previousVisits = sumVisits(previous);
  const revenueCents = sumRevenueCents(current);
  const previousRevenueCents = sumRevenueCents(previous);
  const ova = officeVisitAverage(revenueCents, visits);
  const previousOva = officeVisitAverage(previousRevenueCents, previousVisits);
  const emptyState = periodEmptyState(current);
  const patientKpis = buildPatientKpis(
    patients,
    window.from,
    window.to,
    window.previousFrom,
    window.previousTo,
  );

  return {
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
    emptyStateCopy: emptyStateCopy(emptyState),
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
      revenueWithoutVisits: current
        .filter((row) => isRevenueWithoutVisits(row.visits, row.revenueCents))
        .map((row) => ({
          date: row.date,
          visits: row.visits,
          revenue: centsToDollars(row.revenueCents),
          revenueCents: row.revenueCents,
        })),
    },
  };
}
