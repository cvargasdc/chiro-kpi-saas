/**
 * Patients + conversion funnel helpers.
 *
 * Unified on `patients` (Week 8). See docs/WEEK8-PATIENTS.md.
 *
 * Conversion = converted new patients / new patients in the period.
 * Wellness rows are counted separately and are not in the conversion
 * denominator. Activity date is day1Date, else the UTC date of createdAt.
 */

import {
  compareYmd,
  isValidYmd,
  roundPercent,
  startOfMonth,
  toYmd,
  type EmptyState,
} from "./kpis";

export const PATIENT_TYPES = ["new", "wellness"] as const;
export type PatientType = (typeof PATIENT_TYPES)[number];

export const CARE_STATUSES = [
  "new",
  "in_care",
  "wellness",
  "discharged",
  "lost",
] as const;
export type CareStatus = (typeof CARE_STATUSES)[number];

export const PATIENT_RECORD_STATUSES = ["active", "inactive"] as const;
export type PatientRecordStatus = (typeof PATIENT_RECORD_STATUSES)[number];

export const UNSPECIFIED_REFERRAL = "Unspecified";

export const MAX_PATIENT_NAME = 200;
export const MAX_PATIENT_NOTES = 2_000;
export const MAX_CONDITION_LENGTH = 500;
export const MAX_PLAN_TYPE = 80;
export const MAX_TYPE_NAME = 80;
export const MAX_REFERRAL_NAME = 120;
export const MAX_PHONE = 40;
export const PATIENT_LIST_DEFAULT = 50;
export const PATIENT_LIST_MAX = 200;

export const MONTH_RE = /^\d{4}-\d{2}$/;

export const CONVERSION_FORMULA =
  "converted / new in period; null when newCount is 0. Period uses day1Date, else createdAt (UTC date). Wellness is excluded.";

export const NEW_PATIENT_FORMULA =
  "count of patientType=new with activity date (day1Date, else createdAt UTC date) in the period";

export const WELLNESS_PATIENT_FORMULA =
  "count of patientType=wellness with activity date (day1Date, else createdAt UTC date) in the period";

export function isPatientType(value: string): value is PatientType {
  return (PATIENT_TYPES as readonly string[]).includes(value);
}

export function isCareStatus(value: string): value is CareStatus {
  return (CARE_STATUSES as readonly string[]).includes(value);
}

export function isPatientRecordStatus(
  value: string,
): value is PatientRecordStatus {
  return (PATIENT_RECORD_STATUSES as readonly string[]).includes(value);
}

export function isMonthKey(value: string): boolean {
  if (!MONTH_RE.test(value)) return false;
  return isValidYmd(`${value}-01`);
}

/** Last calendar day of YYYY-MM (UTC). */
export function endOfMonth(yyyyMm: string): string {
  if (!isMonthKey(yyyyMm)) throw new Error("invalid_month");
  const [y, m] = yyyyMm.split("-").map(Number);
  return toYmd(new Date(Date.UTC(y, m, 0)));
}

export function monthRange(yyyyMm: string): { from: string; to: string } {
  return { from: `${yyyyMm}-01`, to: endOfMonth(yyyyMm) };
}

export type PatientActivity = {
  day1Date: string | null;
  createdAt: Date | string;
};

/** Funnel activity date: Day 1 if set, otherwise the UTC created date. */
export function activityDate(row: PatientActivity): string {
  if (row.day1Date && isValidYmd(row.day1Date)) return row.day1Date;
  const created =
    row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  return toYmd(created);
}

export function inInclusiveRange(ymd: string, from: string, to: string): boolean {
  return compareYmd(ymd, from) >= 0 && compareYmd(ymd, to) <= 0;
}

export function conversionPercent(
  convertedCount: number,
  newCount: number,
): number | null {
  if (newCount <= 0) return null;
  return roundPercent((convertedCount / newCount) * 100);
}

export function normalizeReferralSource(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

export function referralGroupKey(
  referralSource: string | null | undefined,
): string {
  return normalizeReferralSource(referralSource) ?? UNSPECIFIED_REFERRAL;
}

export type PatientListFilters = {
  q?: string;
  type?: "all" | PatientType;
  month?: string;
  referralSource?: string;
};

export type PatientFilterable = PatientActivity & {
  name: string;
  email: string | null;
  phone: string | null;
  condition: string | null;
  patientType: string;
  referralSource: string | null;
};

export function filterPatients<T extends PatientFilterable>(
  rows: T[],
  filters: PatientListFilters,
): T[] {
  let out = rows;
  if (filters.type && filters.type !== "all") {
    out = out.filter((p) => p.patientType === filters.type);
  }
  if (filters.month) {
    const prefix = filters.month;
    out = out.filter((p) => activityDate(p).startsWith(prefix));
  }
  if (filters.referralSource !== undefined) {
    const needle = filters.referralSource.trim().toLowerCase();
    if (
      needle.length === 0 ||
      needle === UNSPECIFIED_REFERRAL.toLowerCase()
    ) {
      out = out.filter((p) => !normalizeReferralSource(p.referralSource));
    } else {
      out = out.filter(
        (p) => (p.referralSource ?? "").trim().toLowerCase() === needle,
      );
    }
  }
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    if (q) {
      out = out.filter((p) => {
        return (
          p.name.toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q) ||
          (p.phone ?? "").toLowerCase().includes(q) ||
          (p.condition ?? "").toLowerCase().includes(q) ||
          (p.referralSource ?? "").toLowerCase().includes(q)
        );
      });
    }
  }
  return out;
}

export function sortPatients<T extends PatientFilterable>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byDate = compareYmd(activityDate(b), activityDate(a));
    if (byDate !== 0) return byDate;
    return a.name.localeCompare(b.name);
  });
}

export type FunnelRow = PatientActivity & {
  patientType: string;
  converted: boolean;
  referralSource: string | null;
};

export type PeriodFunnel = {
  newCount: number;
  convertedCount: number;
  wellnessCount: number;
  conversionPercent: number | null;
  emptyState: EmptyState;
};

export function periodFunnel(rows: FunnelRow[], from: string, to: string): PeriodFunnel {
  let newCount = 0;
  let convertedCount = 0;
  let wellnessCount = 0;
  for (const row of rows) {
    if (!inInclusiveRange(activityDate(row), from, to)) continue;
    if (row.patientType === "wellness") {
      wellnessCount += 1;
      continue;
    }
    if (row.patientType === "new") {
      newCount += 1;
      if (row.converted) convertedCount += 1;
    }
  }
  return {
    newCount,
    convertedCount,
    wellnessCount,
    conversionPercent: conversionPercent(convertedCount, newCount),
    emptyState:
      newCount === 0 && wellnessCount === 0 ? "no_entries" : "has_data",
  };
}

export type LeaderboardRow = {
  referralSource: string;
  newCount: number;
  convertedCount: number;
  wellnessCount: number;
  conversionPercent: number | null;
};

export function buildReferralLeaderboard(
  rows: FunnelRow[],
  from: string,
  to: string,
): LeaderboardRow[] {
  const groups = new Map<
    string,
    { newCount: number; convertedCount: number; wellnessCount: number }
  >();

  const bump = (key: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { newCount: 0, convertedCount: 0, wellnessCount: 0 };
      groups.set(key, g);
    }
    return g;
  };

  for (const row of rows) {
    if (!inInclusiveRange(activityDate(row), from, to)) continue;
    const key = referralGroupKey(row.referralSource);
    const g = bump(key);
    if (row.patientType === "wellness") {
      g.wellnessCount += 1;
    } else if (row.patientType === "new") {
      g.newCount += 1;
      if (row.converted) g.convertedCount += 1;
    }
  }

  return [...groups.entries()]
    .map(([referralSource, g]) => ({
      referralSource,
      newCount: g.newCount,
      convertedCount: g.convertedCount,
      wellnessCount: g.wellnessCount,
      conversionPercent: conversionPercent(g.convertedCount, g.newCount),
    }))
    .sort((a, b) => {
      if (b.newCount !== a.newCount) return b.newCount - a.newCount;
      if (b.convertedCount !== a.convertedCount) {
        return b.convertedCount - a.convertedCount;
      }
      return a.referralSource.localeCompare(b.referralSource);
    });
}

export function defaultLeaderboardRange(today: string): { from: string; to: string } {
  return { from: startOfMonth(today), to: today };
}
