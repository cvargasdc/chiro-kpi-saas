import { CONVERSION_FORMULA, buildReferralLeaderboard } from "@shared/patients";
import {
  buildTrendSeries,
  rangesOverlap,
  resolveTrendGrain,
  trendEmptyState,
  trendGrainReason,
  type ReportPeriodWindow,
} from "@shared/reports";
import { publicGoal } from "../goals/public";
import { buildDashboardSnapshot, type DashboardSnapshot } from "../dashboard/compute";
import type {
  StoredDailyStat,
  StoredGoal,
  StoredPatient,
} from "../storage/types";

export type ReportGoalItem = {
  id: string;
  name: string;
  metricType: string;
  status: string;
  statusLabel: string;
  progressPercent: number;
  currentDisplay: string;
  targetDisplay: string;
  startDate: string;
  endDate: string;
};

export type ReportPreview = DashboardSnapshot & {
  comparisonDefinition: string;
  goals: {
    emptyState: "no_goals" | "has_data";
    overlappingCount: number;
    counts: {
      total: number;
      achieved: number;
      onPace: number;
      behindPace: number;
      belowTarget: number;
      expired: number;
    };
    items: ReportGoalItem[];
  };
  referrals: {
    emptyState: "no_entries" | "has_data";
    formula: string;
    rows: ReturnType<typeof buildReferralLeaderboard>;
  };
  trend: {
    grain: "day" | "week";
    grainReason: string;
    emptyState: "no_entries" | "zeros_recorded" | "has_data";
    points: ReturnType<typeof buildTrendSeries>;
  };
};

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

export function buildReportPreview(opts: {
  today: string;
  window: ReportPeriodWindow;
  current: StoredDailyStat[];
  previous: StoredDailyStat[];
  patients: StoredPatient[];
  goals: StoredGoal[];
  goalStats: StoredDailyStat[];
}): ReportPreview {
  const snapshot = buildDashboardSnapshot({
    today: opts.today,
    window: opts.window,
    current: opts.current,
    previous: opts.previous,
    patients: opts.patients,
  });

  const overlapping = opts.goals.filter((row) =>
    rangesOverlap(row.startDate, row.endDate, opts.window.from, opts.window.to),
  );
  const mapped = overlapping.map((row) =>
    publicGoal(row, opts.today, opts.goalStats),
  );
  const counts = {
    total: mapped.length,
    achieved: mapped.filter((row) => row.status === "achieved").length,
    onPace: mapped.filter((row) => row.status === "on_pace").length,
    behindPace: mapped.filter((row) => row.status === "behind_pace").length,
    belowTarget: mapped.filter((row) => row.status === "below_target").length,
    expired: mapped.filter((row) => row.status === "expired").length,
  };

  const referralRows = buildReferralLeaderboard(
    opts.patients,
    opts.window.from,
    opts.window.to,
  );
  const grain = resolveTrendGrain(opts.window.dayCount);
  const points = buildTrendSeries(
    opts.current,
    opts.window.from,
    opts.window.to,
    grain,
  );

  return {
    ...snapshot,
    comparisonDefinition: opts.window.comparisonDefinition,
    goals: {
      emptyState: mapped.length === 0 ? "no_goals" : "has_data",
      overlappingCount: mapped.length,
      counts,
      items: mapped.map((row) => ({
        id: row.id,
        name: row.name,
        metricType: row.metricType,
        status: row.status,
        statusLabel: row.statusLabel,
        progressPercent: row.progressPercent,
        currentDisplay: row.currentDisplay,
        targetDisplay: row.targetDisplay,
        startDate: row.startDate,
        endDate: row.endDate,
      })),
    },
    referrals: {
      emptyState: referralRows.length === 0 ? "no_entries" : "has_data",
      formula: CONVERSION_FORMULA,
      rows: referralRows,
    },
    trend: {
      grain,
      grainReason: trendGrainReason(grain, opts.window.dayCount),
      emptyState: trendEmptyState(points),
      points,
    },
  };
}

export { statsRange };
