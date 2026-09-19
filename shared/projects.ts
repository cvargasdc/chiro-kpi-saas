/**
 * Practice Projects — lightweight kanban (Week 12).
 *
 * Templates share the `projects` table via status = "template" rather than a
 * separate templates table. Duplicating a template (or an existing project)
 * creates a new **active** project with copied columns and tasks.
 *
 * Task titles may mention patients — prefer operational wording. Task notes
 * are treated as possible ePHI and encrypted at rest. Audit metadata holds
 * IDs, counts, and field names — never titles, notes, or assignee names.
 */

import { DATE_RE, isValidYmd } from "./kpis";

export const PROJECT_STATUSES = ["active", "archived", "template"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const DEFAULT_PROJECT_COLUMNS = [
  { name: "Todo", sortOrder: 0 },
  { name: "Doing", sortOrder: 1 },
  { name: "Done", sortOrder: 2 },
] as const;

export const MAX_PROJECT_NAME = 200;
export const MAX_PROJECT_DESCRIPTION = 2_000;
export const MAX_COLUMN_NAME = 80;
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_NOTES = 2_000;
export const MAX_ASSIGNEE_NAME = 80;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 20;
export const MAX_COLUMNS_PER_PROJECT = 12;

export const PROJECTS_GHL_WEBHOOK_NOTE =
  "GoHighLevel webhook ingress is not implemented. CRM contact payloads are not accepted.";

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

export function normalizeTags(raw: unknown): string[] {
  if (raw == null) return [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Completion percent = done tasks / total tasks.
 * Zero tasks → 0 (not 100). Nearest integer.
 */
export function projectCompletionPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const safeDone = Math.max(0, Math.min(done, total));
  return Math.round((safeDone / total) * 100);
}

export function isValidDueDate(value: string | null | undefined): boolean {
  if (value == null || value === "") return true;
  return DATE_RE.test(value) && isValidYmd(value);
}

export function defaultDuplicateName(
  sourceName: string,
  sourceStatus: ProjectStatus,
): string {
  if (sourceStatus === "template") return sourceName;
  const base = sourceName.trim() || "Project";
  if (/\(copy\)$/i.test(base)) return base;
  return `${base} (copy)`;
}
