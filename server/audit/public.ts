import type { StoredAuditLog } from "../storage/types";

const BLOCKED_META_KEY =
  /email|phone|dob|date[_-]?of[_-]?birth|password|token|secret|recovery|ssn|mrn|name|authorization|cookie/i;

/**
 * Owner/admin list view: IDs + action metadata only. Never echo raw PHI
 * even if a buggy caller stuffed it into metadata.
 */
export function publicAuditLog(row: StoredAuditLog): {
  id: string;
  orgId: string;
  practiceId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
} {
  return {
    id: row.id,
    orgId: row.orgId,
    practiceId: row.practiceId,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: sanitizeAuditMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (BLOCKED_META_KEY.test(key)) continue;
    if (typeof value === "string" && looksLikePhi(value)) continue;
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      );
      continue;
    }
    if (typeof value === "object" && value !== null) continue;
    out[key] = value;
  }
  return out;
}

function looksLikePhi(value: string): boolean {
  if (value.includes("@") && value.includes(".")) return true;
  if (/^\d{3}-\d{2}-\d{4}$/.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  return false;
}
