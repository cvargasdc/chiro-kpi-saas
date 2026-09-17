import { describe, expect, it } from "vitest";
import { logAudit, pruneAuditLogs, AUDIT_RETENTION_YEARS } from "../server/audit/logAudit";
import { createMemoryStorage } from "../server/storage/memory";
import { TenantScopeError } from "../server/tenant/scope";

describe("logAudit", () => {
  it("writes an append-only row scoped to org + practice", async () => {
    const storage = createMemoryStorage();
    const org = await storage.createOrganization({ name: "Org" });
    const practice = await storage.createPractice({ orgId: org.id, name: "Clinic" });

    await logAudit(storage, {
      orgId: org.id,
      practiceId: practice.id,
      actorId: "user-1",
      action: "create",
      resourceType: "patient",
      resourceId: "pat-1",
      metadata: { fields: ["name"] },
    });

    const rows = await storage.listAuditLogs({
      orgId: org.id,
      practiceId: practice.id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("create");
    expect(rows[0].resourceType).toBe("patient");
    expect(rows[0].actorId).toBe("user-1");
    expect(rows[0].metadata).toEqual({ fields: ["name"] });
  });

  it("does not write without a tenant scope", async () => {
    const storage = createMemoryStorage();
    await expect(
      logAudit(storage, {
        orgId: "",
        practiceId: "",
        actorId: "user-1",
        action: "read",
        resourceType: "patient",
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    expect(storage.auditLogs).toHaveLength(0);
  });

  it("documents 6-year retention and refuses prune", () => {
    expect(AUDIT_RETENTION_YEARS).toBe(6);
    expect(() => pruneAuditLogs()).toThrow(/6 years/);
  });
});
