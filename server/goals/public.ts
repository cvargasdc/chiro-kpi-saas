import {
  EXPECTED_FORMULA,
  computeGoalProgress,
  formatGoalValue,
  goalUnit,
  isGoalMetricType,
  publicScalar,
  sumGoalCurrentFromStats,
  type DailyStatLike,
  type GoalMetricType,
} from "@shared/goals";
import type { StoredGoal } from "../storage/types";

export type PublicGoal = {
  id: string;
  name: string;
  title: string;
  metricType: GoalMetricType;
  timePeriod: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  unit: "usd_cents" | "count";
  currentSource: "daily_stats" | "manual";
  targetValue: number;
  currentValue: number;
  expectedValue: number;
  target: number;
  current: number;
  expected: number;
  targetDisplay: string;
  currentDisplay: string;
  expectedDisplay: string;
  progressPercent: number;
  elapsedDays: number;
  totalDays: number;
  daysRemaining: number;
  status: string;
  statusLabel: string;
  expectedFormula: string;
};

export function resolveMetricType(value: string): GoalMetricType {
  return isGoalMetricType(value) ? value : "custom";
}

export function resolveCurrentValue(
  row: StoredGoal,
  today: string,
  stats: DailyStatLike[],
): { currentValue: number; currentSource: "daily_stats" | "manual" } {
  const metricType = resolveMetricType(row.metricType);
  if (metricType === "custom") {
    return {
      currentValue: row.currentValue ?? 0,
      currentSource: "manual",
    };
  }
  return {
    currentValue: sumGoalCurrentFromStats(
      metricType,
      row.startDate,
      row.endDate,
      today,
      stats,
    ),
    currentSource: "daily_stats",
  };
}

export function publicGoal(
  row: StoredGoal,
  today: string,
  stats: DailyStatLike[],
): PublicGoal {
  const metricType = resolveMetricType(row.metricType);
  const { currentValue, currentSource } = resolveCurrentValue(row, today, stats);
  const progress = computeGoalProgress({
    targetValue: row.targetValue,
    currentValue,
    startDate: row.startDate,
    endDate: row.endDate,
    today,
  });
  return {
    id: row.id,
    name: row.name,
    title: row.name,
    metricType,
    timePeriod: row.timePeriod,
    startDate: row.startDate,
    endDate: row.endDate,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    unit: goalUnit(metricType),
    currentSource,
    targetValue: row.targetValue,
    currentValue,
    expectedValue: progress.expectedValue,
    target: publicScalar(metricType, row.targetValue),
    current: publicScalar(metricType, currentValue),
    expected: publicScalar(metricType, progress.expectedValue),
    targetDisplay: formatGoalValue(metricType, row.targetValue),
    currentDisplay: formatGoalValue(metricType, currentValue),
    expectedDisplay: formatGoalValue(metricType, progress.expectedValue),
    progressPercent: progress.progressPercent,
    elapsedDays: progress.elapsedDays,
    totalDays: progress.totalDays,
    daysRemaining: progress.daysRemaining,
    status: progress.status,
    statusLabel: progress.statusLabel,
    expectedFormula: EXPECTED_FORMULA,
  };
}
