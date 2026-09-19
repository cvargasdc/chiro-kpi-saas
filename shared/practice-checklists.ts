/**
 * Practice Checklists — clinic ops tasks (daily / weekly).
 *
 * This is NOT patient onboarding. See shared/onboarding.ts and
 * docs/WEEK10-CHECKLISTS-ONBOARDING.md.
 *
 * Completions are per item per canonical date:
 *   daily  → the calendar date
 *   weekly → Monday of the UTC ISO week containing the date
 */

import {
  addDays,
  inclusiveDayCount,
  isValidYmd,
  startOfIsoWeekMonday,
} from "./kpis";

export const PRACTICE_CHECKLIST_CADENCES = ["daily", "weekly"] as const;
export type PracticeChecklistCadence =
  (typeof PRACTICE_CHECKLIST_CADENCES)[number];

export const PRACTICE_CHECKLIST_CATEGORIES = [
  "Opening",
  "Closing",
  "Front desk",
  "Clinical",
  "Admin",
  "Other",
] as const;

export const MAX_CHECKLIST_NAME = 200;
export const MAX_ITEM_TITLE = 200;
export const MAX_ITEM_CATEGORY = 80;
export const MAX_HISTORY_DAYS = 366;

export const PRACTICE_CHECKLISTS_ARE_NOT_ONBOARDING =
  "Practice Checklists are clinic ops tasks (daily/weekly). Patient Onboarding is a separate feature with templates and per-patient progress.";

export function isPracticeChecklistCadence(
  value: string,
): value is PracticeChecklistCadence {
  return (PRACTICE_CHECKLIST_CADENCES as readonly string[]).includes(value);
}

/** Fold known category labels; keep other non-empty strings as typed. */
export function normalizeItemCategory(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const match = PRACTICE_CHECKLIST_CATEGORIES.find(
    (label) => label.toLowerCase() === trimmed.toLowerCase(),
  );
  return match ?? trimmed;
}

/** Canonical completion date for a cadence. */
export function completionDateForCadence(
  cadence: PracticeChecklistCadence,
  date: string,
): string {
  if (!isValidYmd(date)) throw new Error("invalid_date");
  return cadence === "weekly" ? startOfIsoWeekMonday(date) : date;
}

export type ProgressCount = { done: number; total: number };

export type TodayViewItem = {
  id: string;
  checklistId: string;
  title: string;
  category: string;
  sortOrder: number;
  active: boolean;
  completed: boolean;
  completedOn: string | null;
  completedBy: string | null;
};

export type TodayViewChecklist = {
  id: string;
  name: string;
  cadence: PracticeChecklistCadence;
  active: boolean;
  periodDate: string;
  progress: ProgressCount;
  items: TodayViewItem[];
};

export type PracticeChecklistRow = {
  id: string;
  name: string;
  cadence: string;
  active: boolean;
};

export type PracticeChecklistItemRow = {
  id: string;
  checklistId: string;
  title: string;
  category: string;
  sortOrder: number;
  active: boolean;
};

export type PracticeChecklistCompletionRow = {
  itemId: string;
  completedOn: string;
  completed: boolean;
  completedBy: string | null;
};

export function buildTodayView(opts: {
  date: string;
  checklists: PracticeChecklistRow[];
  items: PracticeChecklistItemRow[];
  completions: PracticeChecklistCompletionRow[];
}): {
  date: string;
  weekStart: string;
  emptyState: "no_checklists" | "no_items" | "has_data";
  progress: ProgressCount;
  checklists: TodayViewChecklist[];
} {
  const date = opts.date;
  if (!isValidYmd(date)) throw new Error("invalid_date");
  const weekStart = startOfIsoWeekMonday(date);

  const itemsByChecklist = new Map<string, PracticeChecklistItemRow[]>();
  for (const item of opts.items) {
    const list = itemsByChecklist.get(item.checklistId) ?? [];
    list.push(item);
    itemsByChecklist.set(item.checklistId, list);
  }

  const completionKey = (itemId: string, completedOn: string) =>
    `${itemId}:${completedOn}`;
  const completionMap = new Map<string, PracticeChecklistCompletionRow>();
  for (const row of opts.completions) {
    completionMap.set(completionKey(row.itemId, row.completedOn), row);
  }

  const activeChecklists = opts.checklists
    .filter((c) => c.active)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const views: TodayViewChecklist[] = [];
  let done = 0;
  let total = 0;

  for (const checklist of activeChecklists) {
    const cadence: PracticeChecklistCadence =
      checklist.cadence === "weekly" ? "weekly" : "daily";
    const periodDate = completionDateForCadence(cadence, date);
    const rawItems = (itemsByChecklist.get(checklist.id) ?? [])
      .filter((item) => item.active)
      .slice()
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.title.localeCompare(b.title);
      });

    const items: TodayViewItem[] = rawItems.map((item) => {
      const hit = completionMap.get(completionKey(item.id, periodDate));
      const completed = Boolean(hit?.completed);
      return {
        id: item.id,
        checklistId: item.checklistId,
        title: item.title,
        category: item.category,
        sortOrder: item.sortOrder,
        active: item.active,
        completed,
        completedOn: hit?.completedOn ?? null,
        completedBy: hit?.completedBy ?? null,
      };
    });

    const localDone = items.filter((item) => item.completed).length;
    done += localDone;
    total += items.length;
    views.push({
      id: checklist.id,
      name: checklist.name,
      cadence,
      active: checklist.active,
      periodDate,
      progress: { done: localDone, total: items.length },
      items,
    });
  }

  const emptyState =
    opts.checklists.length === 0
      ? "no_checklists"
      : total === 0
        ? "no_items"
        : "has_data";

  return {
    date,
    weekStart,
    emptyState,
    progress: { done, total },
    checklists: views,
  };
}

export function historyDates(from: string, to: string): string[] {
  const count = inclusiveDayCount(from, to);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(addDays(from, i));
  }
  return dates;
}

export function defaultHistoryRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -13), to: today };
}
