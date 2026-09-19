import {
  PROJECTS_GHL_WEBHOOK_NOTE,
  projectCompletionPercent,
  type ProjectStatus,
} from "@shared/projects";
import type {
  StoredProject,
  StoredProjectColumn,
  StoredProjectTask,
} from "../storage/types";

export const FEATURE_NOTE = {
  kind: "projects" as const,
  ghlWebhook: false,
  note: PROJECTS_GHL_WEBHOOK_NOTE,
};

export type PublicProject = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus | string;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  doneCount: number;
  completionPercent: number;
};

export type PublicProjectColumn = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
};

export type PublicProjectTask = {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  notes: string | null;
  sortOrder: number;
  done: boolean;
  dueDate: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicProjectColumnWithTasks = PublicProjectColumn & {
  tasks: PublicProjectTask[];
  taskCount: number;
  doneCount: number;
};

export function publicProject(
  row: StoredProject,
  counts: { done: number; total: number },
): PublicProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    tags: [...row.tags],
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    taskCount: counts.total,
    doneCount: counts.done,
    completionPercent: projectCompletionPercent(counts.done, counts.total),
  };
}

export function publicProjectColumn(row: StoredProjectColumn): PublicProjectColumn {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    sortOrder: row.sortOrder,
  };
}

export function publicProjectTask(row: StoredProjectTask): PublicProjectTask {
  return {
    id: row.id,
    projectId: row.projectId,
    columnId: row.columnId,
    title: row.title,
    notes: row.notes,
    sortOrder: row.sortOrder,
    done: row.done,
    dueDate: row.dueDate,
    assigneeName: row.assigneeName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function taskCounts(tasks: StoredProjectTask[]): {
  done: number;
  total: number;
} {
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.done).length,
  };
}

export function ghlWebhookNotImplemented() {
  return {
    status: 501 as const,
    body: {
      error: "not_implemented",
      message: PROJECTS_GHL_WEBHOOK_NOTE,
      ghl: false,
      openai: false,
    },
  };
}
