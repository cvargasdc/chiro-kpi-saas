import {
  ONBOARDING_IS_NOT_PRACTICE_CHECKLISTS,
  deriveChecklistStatus,
  type PatientOnboardingChecklistSummary,
} from "@shared/onboarding";
import type {
  StoredChecklistTemplate,
  StoredChecklistTemplateTask,
  StoredPatientChecklist,
  StoredPatientChecklistTask,
} from "../storage/types";

export const FEATURE_NOTE = {
  kind: "patient_onboarding" as const,
  practiceChecklists: false,
  note: ONBOARDING_IS_NOT_PRACTICE_CHECKLISTS,
};

export function publicChecklistTemplate(
  row: StoredChecklistTemplate,
  tasks: StoredChecklistTemplateTask[] = [],
) {
  return {
    id: row.id,
    name: row.name,
    patientType: row.patientType,
    active: row.active,
    taskCount: tasks.length,
    tasks: tasks.map(publicTemplateTask),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicTemplateTask(row: StoredChecklistTemplateTask) {
  return {
    id: row.id,
    templateId: row.templateId,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicPatientChecklistTask(row: StoredPatientChecklistTask) {
  return {
    id: row.id,
    patientChecklistId: row.patientChecklistId,
    title: row.title,
    done: row.done,
    assigneeName: row.assigneeName,
    notes: row.notes,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicPatientChecklist(
  row: StoredPatientChecklist,
  tasks: StoredPatientChecklistTask[],
) {
  const status = deriveChecklistStatus(tasks);
  const doneCount = tasks.filter((task) => task.done).length;
  return {
    id: row.id,
    patientId: row.patientId,
    templateId: row.templateId,
    templateName: row.templateName,
    status,
    notes: row.notes,
    doneCount,
    totalCount: tasks.length,
    tasks: tasks.map(publicPatientChecklistTask),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function patientChecklistSummary(
  row: StoredPatientChecklist,
  tasks: StoredPatientChecklistTask[],
): PatientOnboardingChecklistSummary {
  const pub = publicPatientChecklist(row, tasks);
  return {
    id: pub.id,
    templateId: pub.templateId,
    templateName: pub.templateName,
    status: pub.status,
    doneCount: pub.doneCount,
    totalCount: pub.totalCount,
  };
}
