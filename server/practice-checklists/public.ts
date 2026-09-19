import { PRACTICE_CHECKLISTS_ARE_NOT_ONBOARDING } from "@shared/practice-checklists";
import type {
  StoredPracticeChecklist,
  StoredPracticeChecklistItem,
} from "../storage/types";

export function publicPracticeChecklist(row: StoredPracticeChecklist) {
  return {
    id: row.id,
    name: row.name,
    cadence: row.cadence,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicPracticeChecklistItem(row: StoredPracticeChecklistItem) {
  return {
    id: row.id,
    checklistId: row.checklistId,
    title: row.title,
    category: row.category,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const FEATURE_NOTE = {
  kind: "practice_checklists" as const,
  onboarding: false,
  note: PRACTICE_CHECKLISTS_ARE_NOT_ONBOARDING,
};
