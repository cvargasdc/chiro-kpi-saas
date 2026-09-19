import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { createMemoryStorage } from "../server/storage/memory";
import { isAesGcmCiphertext } from "../server/crypto/aes-gcm";

const STRONG = "CorrectHorse-Battery9!";
const SESSION_SECRET = "test-session-secret-not-for-production";
const NOW = new Date("2026-09-16T12:00:00.000Z");

function testApp() {
  const storage = createMemoryStorage();
  const app = createApp({
    storage,
    now: () => NOW,
    session: {
      secret: SESSION_SECRET,
      secure: false,
      sameSite: "lax",
      trustProxy: false,
    },
  });
  return { app, storage };
}

async function register(app: ReturnType<typeof createApp>, suffix: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({
    email: `${suffix}@clinic.test`,
    username: `user_${suffix}`,
    password: STRONG,
    displayName: `Owner ${suffix}`,
    organizationName: `Org ${suffix}`,
    practiceName: `Practice ${suffix}`,
  });
  expect(res.status).toBe(201);
  return { agent, body: res.body };
}

describe("Daily Log APIs", () => {
  it("creates, lists, reads, updates, and deletes a tenant-scoped entry", async () => {
    const { app } = testApp();
    const a = await register(app, "alpha");

    const created = await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 12,
      revenue: 480.5,
      notes: "Busy Tuesday",
    });
    expect(created.status).toBe(201);
    expect(created.body.entry.visits).toBe(12);
    expect(created.body.entry.revenueCents).toBe(48050);
    expect(created.body.entry.revenue).toBe(480.5);
    expect(created.body.entry.notes).toBe("Busy Tuesday");
    expect(created.body.warnings).toEqual([]);
    expect(created.body.today).toBe("2026-09-16");

    const listed = await a.agent.get("/api/daily-log?from=2026-09-01&to=2026-09-16");
    expect(listed.status).toBe(200);
    expect(listed.body.entries).toHaveLength(1);
    expect(listed.body.emptyState).toBe("has_data");

    const today = await a.agent.get("/api/daily-log/today");
    expect(today.status).toBe(200);
    expect(today.body.entry.date).toBe("2026-09-16");

    const patched = await a.agent.patch("/api/daily-log/2026-09-16").send({
      visits: 13,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.entry.visits).toBe(13);
    expect(patched.body.entry.revenueCents).toBe(48050);

    const deleted = await a.agent.delete("/api/daily-log/2026-09-16");
    expect(deleted.status).toBe(200);
    const missing = await a.agent.get("/api/daily-log/2026-09-16");
    expect(missing.status).toBe(404);
  });

  it("Practice A cannot read or write Practice B daily log", async () => {
    const { app } = testApp();
    const a = await register(app, "alpha");
    const b = await register(app, "bravo");

    const createdB = await b.agent.post("/api/daily-log").send({
      date: "2026-09-15",
      visits: 9,
      revenue: 300,
      notes: "B only",
    });
    expect(createdB.status).toBe(201);

    const listA = await a.agent.get("/api/daily-log?from=2026-09-01&to=2026-09-30");
    expect(listA.status).toBe(200);
    expect(listA.body.entries).toEqual([]);

    const steal = await a.agent.get("/api/daily-log/2026-09-15");
    expect(steal.status).toBe(404);

    const stealPatch = await a.agent.patch("/api/daily-log/2026-09-15").send({ visits: 1 });
    expect(stealPatch.status).toBe(404);

    const stealDelete = await a.agent.delete("/api/daily-log/2026-09-15");
    expect(stealDelete.status).toBe(404);

    const header = await a.agent
      .get("/api/daily-log")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);

    const dashA = await a.agent.get("/api/dashboard?period=this_week");
    expect(dashA.status).toBe(200);
    expect(dashA.body.kpis.visits.value).toBe(0);
    expect(dashA.body.emptyState).toBe("no_entries");
  });

  it("readonly cannot POST daily log; staff can write; staff cannot delete", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "clinic");
    const hash = (await storage.getUserByUsername("user_clinic"))!;

    const reader = await storage.createUser({
      email: "reader@clinic.test",
      username: "reader6",
      passwordHash: hash.passwordHash,
      displayName: "Read Only",
    });
    await storage.createOrgMembership({
      orgId: owner.body.organization.id,
      userId: reader.id,
      role: "readonly",
    });
    await storage.createPracticeMembership({
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      userId: reader.id,
      role: "readonly",
    });

    const staffUser = await storage.createUser({
      email: "staff@clinic.test",
      username: "staff6",
      passwordHash: hash.passwordHash,
      displayName: "Staff",
    });
    await storage.createOrgMembership({
      orgId: owner.body.organization.id,
      userId: staffUser.id,
      role: "staff",
    });
    await storage.createPracticeMembership({
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      userId: staffUser.id,
      role: "staff",
    });

    const readerAgent = request.agent(app);
    expect(
      (await readerAgent.post("/api/auth/login").send({ login: "reader6", password: STRONG }))
        .status,
    ).toBe(200);
    const denied = await readerAgent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 4,
      revenue: 100,
    });
    expect(denied.status).toBe(403);
    expect((await readerAgent.get("/api/daily-log")).status).toBe(200);

    const staffAgent = request.agent(app);
    expect(
      (await staffAgent.post("/api/auth/login").send({ login: "staff6", password: STRONG }))
        .status,
    ).toBe(200);
    const written = await staffAgent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 4,
      revenue: 100,
    });
    expect(written.status).toBe(201);
    const staffDelete = await staffAgent.delete("/api/daily-log/2026-09-16");
    expect(staffDelete.status).toBe(403);
    const ownerDelete = await owner.agent.delete("/api/daily-log/2026-09-16");
    expect(ownerDelete.status).toBe(200);
  });

  it("rejects negative visits and revenue, allows anomaly with a warning", async () => {
    const { app } = testApp();
    const a = await register(app, "anom");

    const negVisits = await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: -1,
      revenue: 10,
    });
    expect(negVisits.status).toBe(400);

    const negRev = await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 1,
      revenue: -0.01,
    });
    expect(negRev.status).toBe(400);

    const anomaly = await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 0,
      revenue: 50,
    });
    expect(anomaly.status).toBe(201);
    expect(anomaly.body.warnings).toEqual([
      expect.objectContaining({ code: "revenue_without_visits" }),
    ]);
    expect(anomaly.body.entry.visits).toBe(0);
    expect(anomaly.body.entry.revenueCents).toBe(5000);
  });

  it("defaults omitted date to today and 409s a duplicate date", async () => {
    const { app } = testApp();
    const a = await register(app, "today");
    const first = await a.agent.post("/api/daily-log").send({
      visits: 2,
      revenue: 80,
    });
    expect(first.status).toBe(201);
    expect(first.body.entry.date).toBe("2026-09-16");
    const dup = await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 3,
      revenue: 90,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_date");
  });

  it("audits writes with field names, not note contents", async () => {
    const { app } = testApp();
    const a = await register(app, "audit");
    await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 5,
      revenue: 200,
      notes: "Named patient should not appear in audit",
    });
    const logs = await a.agent.get("/api/audit-logs");
    expect(logs.status).toBe(200);
    const create = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "daily_log" && row.action === "create",
    );
    expect(create).toBeTruthy();
    expect(JSON.stringify(create)).not.toContain("Named patient");
    expect(create.metadata.fields).toEqual(
      expect.arrayContaining(["visits", "revenue", "notes"]),
    );
  });

  it("stores notes as ciphertext at rest", async () => {
    const { app, storage } = testApp();
    const a = await register(app, "enc");
    await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 1,
      revenue: 10,
      notes: "clinical aside",
    });
    const raw = storage.dailyStats[0];
    expect(raw.notes).toBeTruthy();
    expect(isAesGcmCiphertext(raw.notes!)).toBe(true);
    expect(raw.notes).not.toContain("clinical aside");
  });
});

describe("Dashboard KPIs", () => {
  it("computes visits, revenue, OVA, % change, and empty vs zero states", async () => {
    const { app } = testApp();
    const a = await register(app, "kpis");

    const empty = await a.agent.get("/api/dashboard?period=this_week");
    expect(empty.status).toBe(200);
    expect(empty.body.period.from).toBe("2026-09-14");
    expect(empty.body.period.to).toBe("2026-09-16");
    expect(empty.body.previousFrom).toBe("2026-09-11");
    expect(empty.body.previousTo).toBe("2026-09-13");
    expect(empty.body.comparisonLabel).toContain("3-day");
    expect(empty.body.emptyState).toBe("no_entries");
    expect(empty.body.kpis.officeVisitAverage.value).toBeNull();
    expect(empty.body.kpis.newPatients.available).toBe(false);

    const zero = await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 0,
      revenue: 0,
    });
    expect(zero.status).toBe(201);
    const zeros = await a.agent.get("/api/dashboard?period=this_week");
    expect(zeros.body.emptyState).toBe("zeros_recorded");
    expect(zeros.body.kpis.visits.value).toBe(0);
    expect(zeros.body.kpis.officeVisitAverage.value).toBeNull();

    await a.agent.patch("/api/daily-log/2026-09-16").send({ visits: 10, revenue: 250 });
    await a.agent.post("/api/daily-log").send({
      date: "2026-09-12",
      visits: 5,
      revenue: 100,
    });

    const filled = await a.agent.get("/api/dashboard?period=this_week");
    expect(filled.body.emptyState).toBe("has_data");
    expect(filled.body.kpis.visits.value).toBe(10);
    expect(filled.body.kpis.visits.previousValue).toBe(5);
    expect(filled.body.kpis.visits.percentChange).toBe(100);
    expect(filled.body.kpis.revenue.value).toBe(250);
    expect(filled.body.kpis.revenue.previousValue).toBe(100);
    expect(filled.body.kpis.officeVisitAverage.value).toBe(25);
    expect(filled.body.kpis.officeVisitAverage.previousValue).toBe(20);
  });

  it("surfaces revenue-without-visits anomalies on the dashboard", async () => {
    const { app } = testApp();
    const a = await register(app, "dashanom");
    await a.agent.post("/api/daily-log").send({
      date: "2026-09-15",
      visits: 0,
      revenue: 40,
    });
    const dash = await a.agent.get("/api/dashboard?period=this_week");
    expect(dash.body.anomalies.revenueWithoutVisits).toEqual([
      expect.objectContaining({ date: "2026-09-15", visits: 0, revenue: 40 }),
    ]);
  });
});
