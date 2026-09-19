/**
 * Patient Onboarding — checklist templates + per-patient progress.
 *
 * This is NOT Practice Checklists (clinic daily/weekly ops).
 * See shared/practice-checklists.ts and docs/WEEK10-CHECKLISTS-ONBOARDING.md.
 *
 * Notes on patient_checklists / patient_checklist_tasks are PHI and must be
 * encrypted at rest. Audit metadata holds IDs and field names — never names
 * or note text.
 */

export const ONBOARDING_PATIENT_TYPES = ["new", "wellness", "all"] as const;
export type OnboardingPatientType = (typeof ONBOARDING_PATIENT_TYPES)[number];

export const PATIENT_CHECKLIST_STATUSES = [
  "not_started",
  "in_progress",
  "complete",
] as const;
export type PatientChecklistStatus = (typeof PATIENT_CHECKLIST_STATUSES)[number];

export const MAX_TEMPLATE_NAME = 200;
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_DESCRIPTION = 2_000;
export const MAX_TASK_NOTES = 2_000;
export const MAX_ASSIGNEE_NAME = 120;

export const ONBOARDING_IS_NOT_PRACTICE_CHECKLISTS =
  "Onboarding is patient checklist templates and per-patient progress. Practice Checklists are clinic ops on a different page.";

export function deriveChecklistStatus(
  tasks: Array<{ done: boolean }>,
): PatientChecklistStatus {
  if (tasks.length === 0) return "not_started";
  const done = tasks.filter((task) => task.done).length;
  if (done === 0) return "not_started";
  if (done === tasks.length) return "complete";
  return "in_progress";
}

export type OnboardingProgressEmpty =
  | "no_assignments"
  | "all_complete"
  | "has_incomplete";

export type OnboardingProgress = {
  available: true;
  assignedCount: number;
  incompleteCount: number;
  completeCount: number;
  emptyState: OnboardingProgressEmpty;
};

export function summarizeOnboardingProgress(
  checklists: Array<{ status: string }>,
): OnboardingProgress {
  const assignedCount = checklists.length;
  const completeCount = checklists.filter(
    (row) => row.status === "complete",
  ).length;
  const incompleteCount = assignedCount - completeCount;
  const emptyState: OnboardingProgressEmpty =
    assignedCount === 0
      ? "no_assignments"
      : incompleteCount === 0
        ? "all_complete"
        : "has_incomplete";
  return {
    available: true,
    assignedCount,
    incompleteCount,
    completeCount,
    emptyState,
  };
}

export type PatientOnboardingChecklistSummary = {
  id: string;
  templateId: string | null;
  templateName: string;
  status: PatientChecklistStatus | string;
  doneCount: number;
  totalCount: number;
};

export type PatientOnboardingState = {
  available: true;
  assigned: boolean;
  checklists: PatientOnboardingChecklistSummary[];
  reason?: string;
};

export function patientOnboardingState(
  checklists: PatientOnboardingChecklistSummary[],
): PatientOnboardingState {
  if (checklists.length === 0) {
    return {
      available: true,
      assigned: false,
      checklists: [],
      reason: "No onboarding checklist assigned yet.",
    };
  }
  return {
    available: true,
    assigned: true,
    checklists,
  };
}

export const UNOBSERVED_ONBOARDING: PatientOnboardingState = {
  available: true,
  assigned: false,
  checklists: [],
  reason: "No onboarding checklist assigned yet.",
};
