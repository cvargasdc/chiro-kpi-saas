/**
 * Practice reports — period windows, comparison honesty, and trend series.
 *
 * Comparison matches the dashboard: an equal-length window immediately before
 * `from`, not “previous calendar month/quarter/year” unless the lengths happen
 * to match. See docs/WEEK9-SERVICES-REPORTS.md and docs/WEEK6-DAILY-DASHBOARD.md.
 */

import {
  MAX_PERIOD_DAYS,
  PeriodRangeError,
  addDays,
  centsToDollars,
  compareYmd,
  inclusiveDayCount,
  isValidYmd,
  startOfIsoWeekMonday,
  startOfMonth,
  type EmptyState,
} from "./kpis";

export const REPORT_PERIODS = [
  "weekly",
  "monthly",
  "quarterly",
  "annual",
  "custom",
] as const;

export type ReportPeriodKey = (typeof REPORT_PERIODS)[number];

export function isReportPeriodKey(value: string): value is ReportPeriodKey {
  return (REPORT_PERIODS as readonly string[]).includes(value);
}

/** Use weekly buckets once the window is longer than ~6 weeks. */
export const TREND_WEEK_GRAIN_MIN_DAYS = 46;

export const COMPARISON_DEFINITION =
  "Equal-length window immediately before the current start. Not the previous calendar week/month/quarter/year unless the lengths happen to match.";

export type ReportPeriodWindow = {
  key: ReportPeriodKey;
  from: string;
  to: string;
  label: string;
  comparisonLabel: string;
  comparisonDefinition: string;
  previousFrom: string;
  previousTo: string;
  dayCount: number;
};

export type TrendGrain = "day" | "week";

export type TrendPoint = {
  key: string;
  label: string;
  from: string;
  to: string;
  visits: number;
  revenueCents: number;
  revenue: number;
  partial: boolean;
};

export type DailyLike = {
  date: string;
  visits: number;
  revenueCents: number;
};

export function startOfQuarter(ymd: string): string {
  if (!isValidYmd(ymd)) throw new PeriodRangeError("invalid_date");
  const month = Number(ymd.slice(5, 7));
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${ymd.slice(0, 4)}-${String(quarterStartMonth).padStart(2, "0")}-01`;
}

export function startOfYear(ymd: string): string {
  if (!isValidYmd(ymd)) throw new PeriodRangeError("invalid_date");
  return `${ymd.slice(0, 4)}-01-01`;
}

export function resolveReportPeriod(input: {
  period: ReportPeriodKey;
  today: string;
  from?: string;
  to?: string;
}): ReportPeriodWindow {
  if (!isValidYmd(input.today)) {
    throw new PeriodRangeError("invalid_today");
  }

  let from: string;
  let to: string;
  let label: string;

  if (input.period === "weekly") {
    from = startOfIsoWeekMonday(input.today);
    to = input.today;
    label = "This week (Monday–today, UTC)";
  } else if (input.period === "monthly") {
    from = startOfMonth(input.today);
    to = input.today;
    label = "This month (1st–today, UTC)";
  } else if (input.period === "quarterly") {
    from = startOfQuarter(input.today);
    to = input.today;
    label = "This quarter (quarter start–today, UTC)";
  } else if (input.period === "annual") {
    from = startOfYear(input.today);
    to = input.today;
    label = "This year (Jan 1–today, UTC)";
  } else {
    if (!input.from || !input.to) {
      throw new PeriodRangeError("custom_range_required");
    }
    if (!isValidYmd(input.from) || !isValidYmd(input.to)) {
      throw new PeriodRangeError("invalid_range");
    }
    if (compareYmd(input.from, input.to) > 0) {
      throw new PeriodRangeError("from_after_to");
    }
    from = input.from;
    to = input.to;
    label = `Custom ${from} to ${to}`;
  }

  const dayCount = inclusiveDayCount(from, to);
  if (dayCount > MAX_PERIOD_DAYS) {
    throw new PeriodRangeError("range_too_long");
  }

  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(dayCount - 1));

  return {
    key: input.period,
    from,
    to,
    label,
    comparisonLabel: `Previous ${dayCount}-day period`,
    comparisonDefinition: COMPARISON_DEFINITION,
    previousFrom,
    previousTo,
    dayCount,
  };
}

export function resolveTrendGrain(dayCount: number): TrendGrain {
  return dayCount >= TREND_WEEK_GRAIN_MIN_DAYS ? "week" : "day";
}

export function trendGrainReason(grain: TrendGrain, dayCount: number): string {
  if (grain === "week") {
    return `Window is ${dayCount} days (≥ ${TREND_WEEK_GRAIN_MIN_DAYS}); series is grouped by ISO week (Monday). Partial first/last weeks only count days inside the report window.`;
  }
  return `Window is ${dayCount} days; series is one point per calendar day (UTC), including days with no daily-log row (shown as 0).`;
}

function eachYmd(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (compareYmd(cursor, to) <= 0) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function buildTrendSeries(
  rows: DailyLike[],
  from: string,
  to: string,
  grain: TrendGrain,
): TrendPoint[] {
  const byDate = new Map<string, { visits: number; revenueCents: number }>();
  for (const row of rows) {
    if (compareYmd(row.date, from) < 0 || compareYmd(row.date, to) > 0) continue;
    const existing = byDate.get(row.date);
    if (existing) {
      existing.visits += row.visits;
      existing.revenueCents += row.revenueCents;
    } else {
      byDate.set(row.date, {
        visits: row.visits,
        revenueCents: row.revenueCents,
      });
    }
  }

  if (grain === "day") {
    return eachYmd(from, to).map((date) => {
      const agg = byDate.get(date) ?? { visits: 0, revenueCents: 0 };
      return {
        key: date,
        label: date,
        from: date,
        to: date,
        visits: agg.visits,
        revenueCents: agg.revenueCents,
        revenue: centsToDollars(agg.revenueCents),
        partial: false,
      };
    });
  }

  const buckets = new Map<
    string,
    { from: string; to: string; visits: number; revenueCents: number }
  >();
  for (const date of eachYmd(from, to)) {
    const monday = startOfIsoWeekMonday(date);
    const existing = buckets.get(monday);
    const agg = byDate.get(date) ?? { visits: 0, revenueCents: 0 };
    if (existing) {
      existing.to = date;
      existing.visits += agg.visits;
      existing.revenueCents += agg.revenueCents;
    } else {
      buckets.set(monday, {
        from: date,
        to: date,
        visits: agg.visits,
        revenueCents: agg.revenueCents,
      });
    }
  }

  return [...buckets.entries()].map(([monday, bucket]) => {
    const inWindowDays = inclusiveDayCount(bucket.from, bucket.to);
    return {
      key: monday,
      label: `${bucket.from}–${bucket.to}`,
      from: bucket.from,
      to: bucket.to,
      visits: bucket.visits,
      revenueCents: bucket.revenueCents,
      revenue: centsToDollars(bucket.revenueCents),
      partial: inWindowDays < 7,
    };
  });
}

export function trendEmptyState(points: TrendPoint[]): EmptyState {
  if (points.length === 0) return "no_entries";
  if (points.every((row) => row.visits === 0 && row.revenueCents === 0)) {
    return "zeros_recorded";
  }
  return "has_data";
}

/** Inclusive overlap of [startDate, endDate] with [from, to]. */
export function rangesOverlap(
  startDate: string,
  endDate: string,
  from: string,
  to: string,
): boolean {
  return compareYmd(startDate, to) <= 0 && compareYmd(endDate, from) >= 0;
}
