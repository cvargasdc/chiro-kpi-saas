import { logError } from "../log/redact";
import type { AppStorage } from "../storage/types";
import { requireTenantScope, type TenantScope } from "../tenant/scope";

/** HIPAA §164.530(j) — retain documentation for 6 years. Prune is not active. */
export const AUDIT_RETENTION_YEARS = 6;

export type AuditAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "list"
  | "export"
  | "login"
  | "login_failed"
  | "logout"
  | "denied"
  | "org_created"
  | "practice_created"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_changed"
  | "invite_created"
  | "invite_accepted"
  | "invite_revoked"
  | "mfa_enroll_started"
  | "mfa_enroll_completed"
  | "mfa_disabled"
  | "mfa_verified";

export type LogAuditInput = {
  orgId: string;
  practiceId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
};

export type AuditSink = Pick<AppStorage, "createAuditLog">;

/**
 * Append-only audit write. Failures are logged without PHI (IDs only) so a
 * storage outage cannot silently drop the access attempt from ops visibility.
 */
export async function logAudit(
  storage: AuditSink,
  input: LogAuditInput,
): Promise<void> {
  const scope: TenantScope = requireTenantScope({
    orgId: input.orgId,
    practiceId: input.practiceId,
  });

  try {
    await storage.createAuditLog({
      orgId: scope.orgId,
      practiceId: scope.practiceId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (err) {
    logError("[AUDIT] Failed to write audit log — PHI access may be untracked", {
      orgId: scope.orgId,
      practiceId: scope.practiceId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Intentional no-op. Automated deletion of audit rows is not enabled.
 * Any future prune MUST keep records younger than AUDIT_RETENTION_YEARS.
 */
export function pruneAuditLogs(): never {
  throw new Error(
    `Audit prune is disabled. Retention intent is ${AUDIT_RETENTION_YEARS} years (HIPAA §164.530(j)).`,
  );
}
