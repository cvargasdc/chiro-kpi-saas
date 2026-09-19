import { centsToDollars, isRevenueWithoutVisits } from "@shared/kpis";
import type { StoredDailyStat } from "../storage/types";

export type DailyLogWarning = {
  code: "revenue_without_visits";
  message: string;
};

export type PublicDailyLog = {
  id: string;
  date: string;
  visits: number;
  revenueCents: number;
  revenue: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export function publicDailyLog(row: StoredDailyStat): PublicDailyLog {
  return {
    id: row.id,
    date: row.date,
    visits: row.visits,
    revenueCents: row.revenueCents,
    revenue: centsToDollars(row.revenueCents),
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function dailyLogWarnings(
  visits: number,
  revenueCents: number,
): DailyLogWarning[] {
  if (!isRevenueWithoutVisits(visits, revenueCents)) return [];
  return [
    {
      code: "revenue_without_visits",
      message:
        "Revenue is greater than zero while visits are zero. The row was saved; confirm this is not a data-entry error.",
    },
  ];
}
