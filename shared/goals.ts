/**
 * Practice Goals — progress math, status rules, and money display helpers.
 *
 * Storage units:
 *   - revenue: integer USD cents (same as daily_stats.revenue_cents)
 *   - visits / custom: integer counts
 *
 * Current value:
 *   - revenue / visits: summed from daily_stats in [startDate, min(today, endDate)]
 *     inclusive. Never stored — computed at read time so it cannot go stale.
 *   - custom: stored current_value, updated manually.
 *
 * Linear expected:
 *   expected = target * (elapsedDays / totalDays)
 *
 * Dates are YYYY-MM-DD calendar days in UTC until a practice timezone exists.
 * See docs/WEEK7-GOALS.md.
 */

import {
  centsToDollars,
  compareYmd,
  inclusiveDayCount,
  isValidYmd,
} from "./kpis";

export const GOAL_METRIC_TYPES = ["revenue", "visits", "custom"] as const;
export type GoalMetricType = (typeof GOAL_METRIC_TYPES)[number];

export const GOAL_TIME_PERIODS = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "custom",
] as const;
export type GoalTimePeriod = (typeof GOAL_TIME_PERIODS)[number];

export const GOAL_STATUSES = [
  "achieved",
  "expired",
  "below_target",
  "behind_pace",
  "on_pace",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  achieved: "Achieved",
  expired: "Expired",
  below_target: "Below Target",
  behind_pace: "Behind Pace",
  on_pace: "On Pace",
};

export const MAX_GOAL_NAME = 200;
export const MAX_GOAL_NOTES = 2_000;
export const MAX_GOAL_DAYS = 366 * 3;
export const MAX_GOAL_TARGET = 1_000_000_000_000;

/** Behind Pace: more than one day's linear progress below expected. */
export const BEHIND_PACE_DAYS = 1;

/**
 * Below Target: past the midpoint of the window and current is under 75% of
 * linear expected (i.e. 25%+ behind expected).
 */
export const BELOW_TARGET_EXPECTED_RATIO = 0.75;
export const MIDPOINT_FRACTION = 0.5;

export const EXPECTED_FORMULA = "target * (elapsedDays / totalDays)";

export function isGoalMetricType(value: string): value is GoalMetricType {
  return (GOAL_METRIC_TYPES as readonly string[]).includes(value);
}

export function isGoalTimePeriod(value: string): value is GoalTimePeriod {
  return (GOAL_TIME_PERIODS as readonly string[]).includes(value);
}

export type GoalProgressInput = {
  targetValue: number;
  currentValue: number;
  startDate: string;
  endDate: string;
  today: string;
};

export type GoalProgress = {
  currentValue: number;
  targetValue: number;
  expectedValue: number;
  progressPercent: number;
  elapsedDays: number;
  totalDays: number;
  daysRemaining: number;
  elapsedFraction: number;
  pastMidpoint: boolean;
  status: GoalStatus;
  statusLabel: string;
};

export function goalWindowDays(startDate: string, endDate: string): number {
  if (!isValidYmd(startDate) || !isValidYmd(endDate)) {
    throw new Error("invalid_date");
  }
  if (compareYmd(startDate, endDate) > 0) {
    throw new Error("from_after_to");
  }
  return inclusiveDayCount(startDate, endDate);
}

export function elapsedGoalDays(
  startDate: string,
  endDate: string,
  today: string,
): number {
  const totalDays = goalWindowDays(startDate, endDate);
  if (!isValidYmd(today)) throw new Error("invalid_date");
  if (compareYmd(today, startDate) < 0) return 0;
  if (compareYmd(today, endDate) > 0) return totalDays;
  return inclusiveDayCount(startDate, today);
}

export function remainingGoalDays(endDate: string, today: string): number {
  if (!isValidYmd(endDate) || !isValidYmd(today)) {
    throw new Error("invalid_date");
  }
  if (compareYmd(today, endDate) > 0) return 0;
  return inclusiveDayCount(today, endDate);
}

/**
 * Linear expected progress in native units, rounded to the nearest integer
 * (nearest cent for revenue).
 */
export function expectedProgress(
  targetValue: number,
  elapsedDays: number,
  totalDays: number,
): number {
  if (totalDays <= 0) return 0;
  return Math.round((targetValue * elapsedDays) / totalDays);
}

/**
 * current < expected − (target / totalDays)
 * Integer form: current * totalDays < target * (elapsedDays − BEHIND_PACE_DAYS)
 */
export function isBehindPace(
  currentValue: number,
  targetValue: number,
  elapsedDays: number,
  totalDays: number,
): boolean {
  if (totalDays <= 0 || elapsedDays <= BEHIND_PACE_DAYS) return false;
  return currentValue * totalDays < targetValue * (elapsedDays - BEHIND_PACE_DAYS);
}

/**
 * current < expected * 0.75
 * Integer form: current * totalDays * 4 < target * elapsedDays * 3
 */
export function isBelowTargetPace(
  currentValue: number,
  targetValue: number,
  elapsedDays: number,
  totalDays: number,
): boolean {
  if (totalDays <= 0 || elapsedDays <= 0) return false;
  return currentValue * totalDays * 4 < targetValue * elapsedDays * 3;
}

export function progressPercent(currentValue: number, targetValue: number): number {
  if (targetValue <= 0) return currentValue > 0 ? 100 : 0;
  return Math.round((currentValue / targetValue) * 100);
}

export function deriveGoalStatus(input: {
  currentValue: number;
  targetValue: number;
  startDate: string;
  endDate: string;
  today: string;
}): GoalStatus {
  const totalDays = goalWindowDays(input.startDate, input.endDate);
  const elapsedDays = elapsedGoalDays(input.startDate, input.endDate, input.today);
  const elapsedFraction = totalDays === 0 ? 0 : elapsedDays / totalDays;
  const pastMidpoint = elapsedFraction >= MIDPOINT_FRACTION;

  if (input.currentValue >= input.targetValue && input.targetValue > 0) {
    return "achieved";
  }
  if (compareYmd(input.today, input.endDate) > 0) {
    return "expired";
  }
  if (
    pastMidpoint &&
    isBelowTargetPace(input.currentValue, input.targetValue, elapsedDays, totalDays)
  ) {
    return "below_target";
  }
  if (isBehindPace(input.currentValue, input.targetValue, elapsedDays, totalDays)) {
    return "behind_pace";
  }
  return "on_pace";
}

export function computeGoalProgress(input: GoalProgressInput): GoalProgress {
  const totalDays = goalWindowDays(input.startDate, input.endDate);
  const elapsedDays = elapsedGoalDays(input.startDate, input.endDate, input.today);
  const daysRemaining = remainingGoalDays(input.endDate, input.today);
  const elapsedFraction = totalDays === 0 ? 0 : elapsedDays / totalDays;
  const expectedValue = expectedProgress(input.targetValue, elapsedDays, totalDays);
  const status = deriveGoalStatus(input);
  return {
    currentValue: input.currentValue,
    targetValue: input.targetValue,
    expectedValue,
    progressPercent: progressPercent(input.currentValue, input.targetValue),
    elapsedDays,
    totalDays,
    daysRemaining,
    elapsedFraction,
    pastMidpoint: elapsedFraction >= MIDPOINT_FRACTION,
    status,
    statusLabel: GOAL_STATUS_LABELS[status],
  };
}

function formatCompactNumber(n: number): string {
  if (n >= 100) return String(Math.round(n));
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Compact USD from integer cents. $10,000+ → `$70K` / `$1.5M`.
 * Smaller amounts use full currency (`$1,800.00`). Never emits `$180000`.
 */
export function formatUsdCompact(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) {
    return `${sign}$${formatCompactNumber(abs / 1_000_000)}M`;
  }
  if (abs >= 10_000) {
    return `${sign}$${formatCompactNumber(abs / 1_000)}K`;
  }
  return formatUsdFull(cents);
}

export function formatUsdFull(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(centsToDollars(cents));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatGoalValue(
  metricType: GoalMetricType,
  nativeValue: number,
): string {
  if (metricType === "revenue") return formatUsdCompact(nativeValue);
  return formatCount(nativeValue);
}

export function goalUnit(metricType: GoalMetricType): "usd_cents" | "count" {
  return metricType === "revenue" ? "usd_cents" : "count";
}

export function publicScalar(
  metricType: GoalMetricType,
  nativeValue: number,
): number {
  return metricType === "revenue" ? centsToDollars(nativeValue) : nativeValue;
}

export type DailyStatLike = {
  date: string;
  visits: number;
  revenueCents: number;
};

/**
 * Inclusive [startDate, min(today, endDate)]. Future days after today are
 * not counted even if the goal window continues.
 */
export function sumGoalCurrentFromStats(
  metricType: GoalMetricType,
  startDate: string,
  endDate: string,
  today: string,
  rows: DailyStatLike[],
): number {
  if (metricType === "custom") return 0;
  const to = compareYmd(today, endDate) < 0 ? today : endDate;
  if (compareYmd(to, startDate) < 0) return 0;
  let visits = 0;
  let revenueCents = 0;
  for (const row of rows) {
    if (compareYmd(row.date, startDate) < 0) continue;
    if (compareYmd(row.date, to) > 0) continue;
    visits += row.visits;
    revenueCents += row.revenueCents;
  }
  return metricType === "revenue" ? revenueCents : visits;
}
