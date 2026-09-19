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

describe("Practice A cannot read Practice B daily log", () => {
  it("listDailyStats and getDailyStatByDate stay practice-scoped", async () => {
    const store = createMemoryStorage();
    const orgA = await store.createOrganization({ name: "Org A" });
    const orgB = await store.createOrganization({ name: "Org B" });
    const practiceA = await store.createPractice({ orgId: orgA.id, name: "A" });
    const practiceB = await store.createPractice({ orgId: orgB.id, name: "B" });
    const practiceA2 = await store.createPractice({
      orgId: orgA.id,
      name: "A2",
    });

    await store.createDailyStat(
      { orgId: orgA.id, practiceId: practiceA.id },
      { date: "2026-09-16", visits: 4, revenueCents: 40000 },
    );
    await store.createDailyStat(
      { orgId: orgB.id, practiceId: practiceB.id },
      { date: "2026-09-16", visits: 9, revenueCents: 90000 },
    );
    await store.createDailyStat(
      { orgId: orgA.id, practiceId: practiceA2.id },
      { date: "2026-09-16", visits: 1, revenueCents: 1000 },
    );

    const listA = await store.listDailyStats({
      orgId: orgA.id,
      practiceId: practiceA.id,
    });
    expect(listA).toHaveLength(1);
    expect(listA[0].visits).toBe(4);

    const stolen = await store.getDailyStatByDate(
      { orgId: orgA.id, practiceId: practiceA.id },
      "2026-09-16",
    );
    expect(stolen?.visits).toBe(4);

    const unscoped = store.listDailyStatsMissingPracticeFilter(orgA.id);
    expect(unscoped).toHaveLength(2);

    await expect(
      store.listDailyStats({ orgId: orgA.id } as { orgId: string; practiceId: string }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe("Practice A cannot read Practice B goals", () => {
  it("listGoals and getGoal stay practice-scoped", async () => {
    const store = createMemoryStorage();
    const orgA = await store.createOrganization({ name: "Org A" });
    const orgB = await store.createOrganization({ name: "Org B" });
    const practiceA = await store.createPractice({ orgId: orgA.id, name: "A" });
    const practiceB = await store.createPractice({ orgId: orgB.id, name: "B" });
    const practiceA2 = await store.createPractice({
      orgId: orgA.id,
      name: "A2",
    });

    await store.createGoal(
      { orgId: orgA.id, practiceId: practiceA.id },
      {
        name: "A revenue",
        metricType: "revenue",
        targetValue: 100000,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      },
    );
    await store.createGoal(
      { orgId: orgB.id, practiceId: practiceB.id },
      {
        name: "B revenue",
        metricType: "revenue",
        targetValue: 200000,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      },
    );
    await store.createGoal(
      { orgId: orgA.id, practiceId: practiceA2.id },
      {
        name: "A2 visits",
        metricType: "visits",
        targetValue: 50,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      },
    );

    const listA = await store.listGoals({
      orgId: orgA.id,
      practiceId: practiceA.id,
    });
    expect(listA).toHaveLength(1);
    expect(listA[0].name).toBe("A revenue");

    const stolen = await store.getGoal(
      { orgId: orgA.id, practiceId: practiceA.id },
      listA[0].id,
    );
    expect(stolen?.name).toBe("A revenue");

    const unscoped = store.listGoalsMissingPracticeFilter(orgA.id);
    expect(unscoped).toHaveLength(2);

    await expect(
      store.listGoals({ orgId: orgA.id } as { orgId: string; practiceId: string }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe("Practice A cannot read Practice B referral sources", () => {
  it("listReferralSources stays practice-scoped", async () => {
    const store = createMemoryStorage();
    const orgA = await store.createOrganization({ name: "Org A" });
    const orgB = await store.createOrganization({ name: "Org B" });
    const practiceA = await store.createPractice({ orgId: orgA.id, name: "A" });
    const practiceB = await store.createPractice({ orgId: orgB.id, name: "B" });
    const practiceA2 = await store.createPractice({
      orgId: orgA.id,
      name: "A2",
    });

    await store.ensureReferralSource(
      { orgId: orgA.id, practiceId: practiceA.id },
      "Google",
    );
    await store.ensureReferralSource(
      { orgId: orgB.id, practiceId: practiceB.id },
      "Facebook",
    );
    await store.ensureReferralSource(
      { orgId: orgA.id, practiceId: practiceA2.id },
      "Walk-in",
    );

    const listA = await store.listReferralSources({
      orgId: orgA.id,
      practiceId: practiceA.id,
    });
    expect(listA.map((r) => r.name)).toEqual(["Google"]);

    const unscoped = store.listReferralSourcesMissingPracticeFilter(orgA.id);
    expect(unscoped).toHaveLength(2);

    await expect(
      store.listReferralSources({ orgId: orgA.id } as {
        orgId: string;
        practiceId: string;
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});
