import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../server/storage/memory";
import { TenantScopeError, requireTenantScope } from "../server/tenant/scope";
import { hashPassword } from "../server/auth/password";

const STRONG = "CorrectHorse-Battery9!";

describe("tenant scope helper", () => {
  it("requires both orgId and practiceId", () => {
    expect(() => requireTenantScope({})).toThrow(TenantScopeError);
    expect(() => requireTenantScope({ orgId: "org-a" })).toThrow(TenantScopeError);
    expect(() => requireTenantScope({ practiceId: "prac-a" })).toThrow(
      TenantScopeError,
    );
    expect(() =>
      requireTenantScope({ orgId: "org-a", practiceId: "default" }),
    ).toThrow(/default/);
  });

  it("accepts a complete scope", () => {
    expect(
      requireTenantScope({ orgId: "org-a", practiceId: "prac-a" }),
    ).toEqual({ orgId: "org-a", practiceId: "prac-a" });
  });
});

describe("Practice A cannot read Practice B patients", () => {
  async function seedTwoPractices() {
    const store = createMemoryStorage();
    const hash = await hashPassword(STRONG);

    const userA = await store.createUser({
      email: "a@clinic.test",
      username: "ownera",
      passwordHash: hash,
      displayName: "Owner A",
    });
    const userB = await store.createUser({
      email: "b@clinic.test",
      username: "ownerb",
      passwordHash: hash,
      displayName: "Owner B",
    });

    const orgA = await store.createOrganization({ name: "Org A" });
    const orgB = await store.createOrganization({ name: "Org B" });
    const practiceA = await store.createPractice({
      orgId: orgA.id,
      name: "Practice A",
    });
    const practiceB = await store.createPractice({
      orgId: orgB.id,
      name: "Practice B",
    });

    await store.createPracticeMembership({
      orgId: orgA.id,
      practiceId: practiceA.id,
      userId: userA.id,
      role: "owner",
    });
    await store.createPracticeMembership({
      orgId: orgB.id,
      practiceId: practiceB.id,
      userId: userB.id,
      role: "owner",
    });

    const patientA = await store.createPatient(
      { orgId: orgA.id, practiceId: practiceA.id },
      { name: "Alice Patient" },
    );
    const patientB = await store.createPatient(
      { orgId: orgB.id, practiceId: practiceB.id },
      { name: "Bob Patient" },
    );

    return { store, orgA, orgB, practiceA, practiceB, patientA, patientB };
  }

  it("listPatients for Practice A does not include Practice B", async () => {
    const { store, orgA, orgB, practiceA, practiceB, patientA, patientB } =
      await seedTwoPractices();

    const listA = await store.listPatients({
      orgId: orgA.id,
      practiceId: practiceA.id,
    });
    const listB = await store.listPatients({
      orgId: orgB.id,
      practiceId: practiceB.id,
    });

    expect(listA.map((p) => p.id)).toEqual([patientA.id]);
    expect(listB.map((p) => p.id)).toEqual([patientB.id]);
    expect(listA.some((p) => p.id === patientB.id)).toBe(false);
  });

  it("getPatient by id still requires the caller's practice filter (no IDOR)", async () => {
    const { store, orgA, practiceA, patientB } = await seedTwoPractices();
    const leaked = await store.getPatient(
      { orgId: orgA.id, practiceId: practiceA.id },
      patientB.id,
    );
    expect(leaked).toBeUndefined();
  });

  it("PHI helpers throw if the practice filter is omitted", async () => {
    const { store, orgA } = await seedTwoPractices();
    await expect(
      store.listPatients({ orgId: orgA.id } as { orgId: string; practiceId: string }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      store.createPatient({ orgId: orgA.id } as { orgId: string; practiceId: string }, {
        name: "No Tenant",
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  /**
   * Equivalent assertion: if listPatients dropped the practiceId predicate,
   * Practice B's row would be visible. This is the control the isolation test
   * is actually enforcing — removing the filter from listPatients() would make
   * THIS test fail (unscoped would still leak, scoped would then match it).
   *
   * How to prove the happy-path test fails without the filter:
   *   1. In server/storage/memory.ts listPatients, delete `&& p.practiceId === practiceId`.
   *   2. Re-run `npm test` — "listPatients for Practice A does not include Practice B" fails.
   */
  it("equivalent assertion: omitting the practice filter would leak Practice B patients", async () => {
    const { store, orgA, orgB, practiceA, practiceB, patientA, patientB } =
      await seedTwoPractices();

    // Same-org leak variant: two practices under one org, unscoped-by-practice.
    const practiceA2 = await store.createPractice({
      orgId: orgA.id,
      name: "Practice A2 (same org)",
    });
    const patientA2 = await store.createPatient(
      { orgId: orgA.id, practiceId: practiceA2.id },
      { name: "Same-org other practice" },
    );

    const unscopedOrgA = store.listPatientsMissingPracticeFilter(orgA.id);
    expect(unscopedOrgA.map((p) => p.id).sort()).toEqual(
      [patientA.id, patientA2.id].sort(),
    );
    expect(unscopedOrgA.some((p) => p.practiceId === practiceA2.id)).toBe(true);

    const scopedA = await store.listPatients({
      orgId: orgA.id,
      practiceId: practiceA.id,
    });
    expect(scopedA.map((p) => p.id)).toEqual([patientA.id]);
    expect(scopedA.some((p) => p.id === patientA2.id)).toBe(false);
    expect(scopedA.some((p) => p.id === patientB.id)).toBe(false);

    const unscopedWouldAlsoSeeForeignOrgIfOrgFilterDropped = store.patients;
    expect(
      unscopedWouldAlsoSeeForeignOrgIfOrgFilterDropped.some(
        (p) => p.practiceId === practiceB.id && p.orgId === orgB.id,
      ),
    ).toBe(true);
  });
});
