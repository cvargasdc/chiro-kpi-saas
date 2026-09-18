import { logAudit } from "../audit/logAudit";
import type { AppStorage } from "../storage/types";

export async function logUserAudit(
  storage: AppStorage,
  input: {
    userId: string;
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
  },
): Promise<void> {
  const practices = await storage.listPracticesForUser(input.userId);
  const first = practices[0];
  if (!first) return;
  await logAudit(storage, {
    orgId: first.orgId,
    practiceId: first.id,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
    ipAddress: input.ipAddress,
  });
}
