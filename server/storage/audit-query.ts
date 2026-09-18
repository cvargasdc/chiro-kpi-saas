export type AuditLogQuery = {
  limit?: number;
  offset?: number;
};

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

export function normalizeAuditQuery(query: AuditLogQuery | undefined): {
  limit: number;
  offset: number;
} {
  const rawLimit = query?.limit ?? AUDIT_PAGE_DEFAULT;
  const limit = Math.min(
    AUDIT_PAGE_MAX,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : AUDIT_PAGE_DEFAULT),
  );
  const rawOffset = query?.offset ?? 0;
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);
  return { limit, offset };
}
