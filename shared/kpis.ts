/**
 * Daily Log + Dashboard KPI helpers.
 *
 * Money: stored as integer USD cents. The HTTP API also exposes `revenue` in
 * dollars (number, nearest cent). See docs/WEEK6-DAILY-DASHBOARD.md.
 *
 * Dates: YYYY-MM-DD calendar days in UTC until a practice timezone exists.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_VISITS = 100_000;
export const MAX_REVENUE_CENTS = 1_000_000_000; // $10,000,000.00
export const MAX_NOTES_LENGTH = 2_000;
export const MAX_PERIOD_DAYS = 366;

export type PeriodKey = "this_week" | "this_month" | "custom";

export type EmptyState = "no_entries" | "zeros_recorded" | "has_data";

export type PeriodWindow = {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
  comparisonLabel: string;
  previousFrom: string;
  previousTo: string;
  dayCount: number;
};

export function isValidYmd(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** UTC calendar date of the given instant. */
export function toYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(ymd: string, days: number): string {
  if (!isValidYmd(ymd)) {
    throw new Error("invalid_date");
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toYmd(dt);
}

export function compareYmd(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Inclusive count of calendar days in [from, to]. */
export function inclusiveDayCount(from: string, to: string): number {
  if (!isValidYmd(from) || !isValidYmd(to) || compareYmd(from, to) > 0) {
    throw new Error("invalid_range");
  }
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** Monday of the UTC ISO week containing `ymd`. */
export function startOfIsoWeekMonday(ymd: string): string {
  if (!isValidYmd(ymd)) throw new Error("invalid_date");
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? 6 : day - 1;
  return addDays(ymd, -offset);
}

export function startOfMonth(ymd: string): string {
  if (!isValidYmd(ymd)) throw new Error("invalid_date");
  return `${ymd.slice(0, 7)}-01`;
}

export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error("invalid_revenue");
  }
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Office Visit Average (OVA) in dollars.
 * `null` when visits === 0 (division undefined). Rounded to the nearest cent.
 */
export function officeVisitAverage(
  revenueCents: number,
  visits: number,
): number | null {
  if (visits <= 0) return null;
  return centsToDollars(Math.round(revenueCents / visits));
}

/**
 * Percent change: ((current - previous) / previous) * 100.
 * `null` when previous is 0 (no baseline — we do not invent +100%).
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function roundPercent(value: number | null, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function periodEmptyState(
  entries: Array<{ visits: number; revenueCents: number }>,
): EmptyState {
  if (entries.length === 0) return "no_entries";
  if (entries.every((row) => row.visits === 0 && row.revenueCents === 0)) {
    return "zeros_recorded";
  }
  return "has_data";
}

export function isRevenueWithoutVisits(
  visits: number,
  revenueCents: number,
): boolean {
  return revenueCents > 0 && visits === 0;
}

export class PeriodRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodRangeError";
  }
}

export function resolvePeriod(input: {
  period: PeriodKey;
  today: string;
  from?: string;
  to?: string;
}): PeriodWindow {
  if (!isValidYmd(input.today)) {
    throw new PeriodRangeError("invalid_today");
  }

  let from: string;
  let to: string;
  let label: string;

  if (input.period === "this_week") {
    from = startOfIsoWeekMonday(input.today);
    to = input.today;
    label = "This week (Monday–today, UTC)";
  } else if (input.period === "this_month") {
    from = startOfMonth(input.today);
    to = input.today;
    label = "This month (1st–today, UTC)";
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
    previousFrom,
    previousTo,
    dayCount,
  };
}

export function defaultListRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}
