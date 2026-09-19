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

describe("Goals APIs", () => {
  it("creates a revenue goal, computes current from daily_stats, and formats money", async () => {
    const { app } = testApp();
    const a = await register(app, "goalsrev");

    await a.agent.post("/api/daily-log").send({
      date: "2026-09-10",
      visits: 4,
      revenue: 400,
    });
    await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 6,
      revenue: 600,
    });

    const created = await a.agent.post("/api/goals").send({
      title: "September collections",
      metricType: "revenue",
      target: 70000,
      timePeriod: "monthly",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      notes: "Do not leak this note",
    });
    expect(created.status).toBe(201);
    expect(created.body.goal.name).toBe("September collections");
    expect(created.body.goal.title).toBe("September collections");
    expect(created.body.goal.targetValue).toBe(7_000_000);
    expect(created.body.goal.target).toBe(70000);
    expect(created.body.goal.targetDisplay).toBe("$70K");
    expect(created.body.goal.currentValue).toBe(100_000);
    expect(created.body.goal.current).toBe(1000);
    expect(created.body.goal.currentDisplay).toBe("$1,000.00");
    expect(created.body.goal.currentSource).toBe("daily_stats");
    expect(created.body.goal.unit).toBe("usd_cents");
    expect(created.body.goal.elapsedDays).toBe(16);
    expect(created.body.goal.totalDays).toBe(30);
    expect(created.body.goal.expectedFormula).toBe(
      "target * (elapsedDays / totalDays)",
    );
    expect(created.body.goal.status).toBe("below_target");
    expect(JSON.stringify(created.body)).not.toMatch(/\$70000(?!\.)/);
    expect(JSON.stringify(created.body)).not.toContain("$180000");

    const listed = await a.agent.get("/api/goals");
    expect(listed.status).toBe(200);
    expect(listed.body.goals).toHaveLength(1);
    expect(listed.body.expiredCount).toBe(0);
    expect(listed.body.goals[0].progressPercent).toBe(1);

    const one = await a.agent.get(`/api/goals/${created.body.goal.id}`);
    expect(one.status).toBe(200);
    expect(one.body.goal.currentValue).toBe(100_000);
  });

  it("computes visits from daily_stats and uses stored current for custom", async () => {
    const { app } = testApp();
    const a = await register(app, "goalmix");

    await a.agent.post("/api/daily-log").send({
      date: "2026-09-12",
      visits: 10,
      revenue: 50,
    });

    const visits = await a.agent.post("/api/goals").send({
      name: "Visit volume",
      metricType: "visits",
      targetValue: 100,
      startDate: "2026-09-10",
      endDate: "2026-09-19",
    });
    expect(visits.status).toBe(201);
    expect(visits.body.goal.currentValue).toBe(10);
    expect(visits.body.goal.currentDisplay).toBe("10");
    expect(visits.body.goal.targetDisplay).toBe("100");
    expect(visits.body.goal.status).toBe("below_target");

    const custom = await a.agent.post("/api/goals").send({
      name: "Checklist items",
      metricType: "custom",
      targetValue: 20,
      currentValue: 18,
      startDate: "2026-09-10",
      endDate: "2026-09-19",
    });
    expect(custom.status).toBe(201);
    expect(custom.body.goal.currentValue).toBe(18);
    expect(custom.body.goal.currentSource).toBe("manual");
    expect(custom.body.goal.status).toBe("on_pace");

    const patched = await a.agent.patch(`/api/goals/${custom.body.goal.id}`).send({
      currentValue: 20,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.goal.status).toBe("achieved");
    expect(patched.body.goal.progressPercent).toBe(100);
  });

  it("hides expired goals unless includeExpired=true and still returns expiredCount", async () => {
    const { app } = testApp();
    const a = await register(app, "goalexp");

    const expired = await a.agent.post("/api/goals").send({
      name: "August leftover",
      metricType: "visits",
      targetValue: 40,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(expired.status).toBe(201);
    expect(expired.body.goal.status).toBe("expired");

    const active = await a.agent.post("/api/goals").send({
      name: "This month",
      metricType: "visits",
      targetValue: 40,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(active.status).toBe(201);
    expect(active.body.goal.status).not.toBe("expired");

    const hidden = await a.agent.get("/api/goals");
    expect(hidden.body.includeExpired).toBe(false);
    expect(hidden.body.expiredCount).toBe(1);
    expect(hidden.body.goals.map((g: { name: string }) => g.name)).toEqual([
      "This month",
    ]);

    const shown = await a.agent.get("/api/goals?includeExpired=true");
    expect(shown.body.includeExpired).toBe(true);
    expect(shown.body.expiredCount).toBe(1);
    expect(shown.body.goals).toHaveLength(2);
  });

  it("Practice A cannot read or write Practice B goals", async () => {
    const { app } = testApp();
    const a = await register(app, "galpha");
    const b = await register(app, "gbravo");

    const createdB = await b.agent.post("/api/goals").send({
      name: "B only",
      metricType: "revenue",
      target: 5000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(createdB.status).toBe(201);
    const bId = createdB.body.goal.id;

    const listA = await a.agent.get("/api/goals");
    expect(listA.status).toBe(200);
    expect(listA.body.goals).toEqual([]);

    const steal = await a.agent.get(`/api/goals/${bId}`);
    expect(steal.status).toBe(404);

    const stealPatch = await a.agent.patch(`/api/goals/${bId}`).send({ name: "hack" });
    expect(stealPatch.status).toBe(404);

    const stealDelete = await a.agent.delete(`/api/goals/${bId}`);
    expect(stealDelete.status).toBe(404);

    const header = await a.agent
      .get("/api/goals")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("readonly cannot create goals; staff can write; staff cannot delete", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "gclinic");
    const hash = (await storage.getUserByUsername("user_gclinic"))!;

    const reader = await storage.createUser({
      email: "greader@clinic.test",
      username: "greader7",
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
      email: "gstaff@clinic.test",
      username: "gstaff7",
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
      (
        await readerAgent
          .post("/api/auth/login")
          .send({ login: "greader7", password: STRONG })
      ).status,
    ).toBe(200);
    const denied = await readerAgent.post("/api/goals").send({
      name: "Nope",
      metricType: "visits",
      targetValue: 10,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(denied.status).toBe(403);
    expect((await readerAgent.get("/api/goals")).status).toBe(200);

    const staffAgent = request.agent(app);
    expect(
      (
        await staffAgent
          .post("/api/auth/login")
          .send({ login: "gstaff7", password: STRONG })
      ).status,
    ).toBe(200);
    const written = await staffAgent.post("/api/goals").send({
      name: "Staff goal",
      metricType: "visits",
      targetValue: 10,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(written.status).toBe(201);
    const staffDelete = await staffAgent.delete(`/api/goals/${written.body.goal.id}`);
    expect(staffDelete.status).toBe(403);
    const ownerDelete = await owner.agent.delete(`/api/goals/${written.body.goal.id}`);
    expect(ownerDelete.status).toBe(200);
  });

  it("ignores stored currentValue for revenue and audits without note contents", async () => {
    const { app, storage } = testApp();
    const a = await register(app, "gaudit");

    await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 2,
      revenue: 80,
    });

    const created = await a.agent.post("/api/goals").send({
      name: "Stale check",
      metricType: "revenue",
      target: 800,
      currentValue: 999999,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      notes: "Named patient should not appear in audit",
    });
    expect(created.status).toBe(201);
    expect(created.body.goal.currentValue).toBe(8000);
    expect(created.body.goal.currentSource).toBe("daily_stats");

    const raw = storage.goals[0];
    expect(raw.currentValue).toBeNull();
    expect(raw.notes).toBeTruthy();
    expect(isAesGcmCiphertext(raw.notes!)).toBe(true);
    expect(raw.notes).not.toContain("Named patient");

    const logs = await a.agent.get("/api/audit-logs");
    expect(logs.status).toBe(200);
    const create = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "goal" && row.action === "create",
    );
    expect(create).toBeTruthy();
    expect(JSON.stringify(create)).not.toContain("Named patient");
    expect(create.metadata.metricType).toBe("revenue");
    expect(create.metadata.fields).toEqual(
      expect.arrayContaining(["name", "metricType", "notes"]),
    );
  });

  it("rejects invalid windows, mismatched money, and empty names", async () => {
    const { app } = testApp();
    const a = await register(app, "gbad");

    const inverted = await a.agent.post("/api/goals").send({
      name: "Backwards",
      metricType: "visits",
      targetValue: 10,
      startDate: "2026-09-30",
      endDate: "2026-09-01",
    });
    expect(inverted.status).toBe(400);
    expect(inverted.body.error).toBe("from_after_to");

    const mismatch = await a.agent.post("/api/goals").send({
      name: "Mismatch",
      metricType: "revenue",
      target: 100,
      targetValue: 1,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("target_mismatch");

    const noName = await a.agent.post("/api/goals").send({
      metricType: "visits",
      targetValue: 10,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(noName.status).toBe(400);
  });
});
