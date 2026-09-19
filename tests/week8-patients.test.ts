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

describe("Patient conversion funnel APIs", () => {
  it("creates a funnel patient, lists with filters, and reads the profile", async () => {
    const { app } = testApp();
    const a = await register(app, "patcreate");

    const created = await a.agent.post("/api/patients").send({
      name: "Casey Spine",
      email: "casey@clinic.test",
      phone: "555-0100",
      dateOfBirth: "1975-06-01",
      patientType: "new",
      referralSource: "Google",
      day1Date: "2026-09-15",
      day2Date: "2026-09-16",
      careStatus: "in_care",
      condition: "LBP",
      notes: "Day-1 exam notes",
    });
    expect(created.status).toBe(201);
    expect(created.body.patient.name).toBe("Casey Spine");
    expect(created.body.patient.patientType).toBe("new");
    expect(created.body.patient.referralSource).toBe("Google");
    expect(created.body.patient.converted).toBe(false);
    expect(created.body.patient.onboarding.available).toBe(false);

    const listed = await a.agent.get("/api/patients?type=new&month=2026-09");
    expect(listed.status).toBe(200);
    expect(listed.body.emptyState).toBe("has_data");
    expect(listed.body.patients).toHaveLength(1);
    expect(listed.body.page.total).toBe(1);

    const wellnessTab = await a.agent.get("/api/patients?tab=wellness");
    expect(wellnessTab.body.patients).toHaveLength(0);
    expect(wellnessTab.body.emptyState).toBe("no_matches");

    const search = await a.agent.get("/api/patients?q=casey");
    expect(search.body.patients).toHaveLength(1);

    const detail = await a.agent.get(`/api/patients/${created.body.patient.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.patient.notes).toBe("Day-1 exam notes");
    expect(detail.body.patient.email).toBe("casey@clinic.test");
  });

  it("Practice A cannot list, fetch, or see Practice B patients on the leaderboard", async () => {
    const { app } = testApp();
    const a = await register(app, "alpha");
    const b = await register(app, "bravo");

    const createdB = await b.agent.post("/api/patients").send({
      name: "Bob from B",
      referralSource: "Facebook",
      day1Date: "2026-09-15",
      converted: true,
    });
    expect(createdB.status).toBe(201);
    const bobId = createdB.body.patient.id;

    const listA = await a.agent.get("/api/patients");
    expect(listA.status).toBe(200);
    expect(listA.body.patients).toEqual([]);

    const steal = await a.agent.get(`/api/patients/${bobId}`);
    expect(steal.status).toBe(404);

    const boardA = await a.agent.get(
      "/api/patients/referral-leaderboard?from=2026-09-01&to=2026-09-30",
    );
    expect(boardA.status).toBe(200);
    expect(boardA.body.rows).toEqual([]);

    await a.agent.post("/api/patients").send({
      name: "Alice from A",
      referralSource: "Google",
      day1Date: "2026-09-16",
    });
    const boardA2 = await a.agent.get(
      "/api/patients/referral-leaderboard?from=2026-09-01&to=2026-09-30",
    );
    expect(boardA2.body.rows.map((r: { referralSource: string }) => r.referralSource)).toEqual([
      "Google",
    ]);
    expect(JSON.stringify(boardA2.body)).not.toContain("Facebook");
    expect(JSON.stringify(boardA2.body)).not.toContain("Bob from B");
  });

  it("readonly cannot POST patients or conversion, but can GET", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "rofunnel");
    const created = await owner.agent.post("/api/patients").send({
      name: "Keep",
      day1Date: "2026-09-16",
    });
    expect(created.status).toBe(201);
    const id = created.body.patient.id as string;

    const hash = (await storage.getUserByUsername("user_rofunnel"))!;
    const readerUser = await storage.createUser({
      email: "readerfunnel@clinic.test",
      username: "readerfunnel",
      passwordHash: hash.passwordHash,
      displayName: "Read Only",
    });
    await storage.createOrgMembership({
      orgId: owner.body.organization.id,
      userId: readerUser.id,
      role: "readonly",
    });
    await storage.createPracticeMembership({
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      userId: readerUser.id,
      role: "readonly",
    });

    const reader = request.agent(app);
    const login = await reader.post("/api/auth/login").send({
      login: "readerfunnel",
      password: STRONG,
    });
    expect(login.status).toBe(200);

    expect((await reader.get("/api/patients")).status).toBe(200);
    expect((await reader.get(`/api/patients/${id}`)).status).toBe(200);
    expect(
      (await reader.get("/api/patients/referral-leaderboard")).status,
    ).toBe(200);
    expect((await reader.post("/api/patients").send({ name: "Nope" })).status).toBe(
      403,
    );
    expect(
      (await reader.post(`/api/patients/${id}/conversion`).send({ converted: true }))
        .status,
    ).toBe(403);
    expect(
      (await reader.patch(`/api/patients/${id}`).send({ careStatus: "in_care" }))
        .status,
    ).toBe(403);
    expect((await reader.delete(`/api/patients/${id}`)).status).toBe(403);
  });

  it("computes referral leaderboard conversion = converted / new in period", async () => {
    const { app } = testApp();
    const a = await register(app, "lbmath");

    await a.agent.post("/api/patients").send({
      name: "G1",
      referralSource: "Google",
      day1Date: "2026-09-15",
      converted: true,
      conversionDate: "2026-09-16",
    });
    await a.agent.post("/api/patients").send({
      name: "G2",
      referralSource: "Google",
      day1Date: "2026-09-16",
    });
    await a.agent.post("/api/patients").send({
      name: "F1",
      referralSource: "Facebook",
      day1Date: "2026-09-16",
    });
    await a.agent.post("/api/patients").send({
      name: "W1",
      patientType: "wellness",
      referralSource: "Google",
      day1Date: "2026-09-16",
    });
    await a.agent.post("/api/patients").send({
      name: "Old",
      referralSource: "Google",
      day1Date: "2026-08-01",
      converted: true,
    });

    const board = await a.agent.get(
      "/api/patients/referral-leaderboard?from=2026-09-14&to=2026-09-16",
    );
    expect(board.status).toBe(200);
    expect(board.body.formula).toMatch(/converted \/ new in period/);
    const google = board.body.rows.find(
      (r: { referralSource: string }) => r.referralSource === "Google",
    );
    const facebook = board.body.rows.find(
      (r: { referralSource: string }) => r.referralSource === "Facebook",
    );
    expect(google).toMatchObject({
      newCount: 2,
      convertedCount: 1,
      wellnessCount: 1,
      conversionPercent: 50,
    });
    expect(facebook).toMatchObject({
      newCount: 1,
      convertedCount: 0,
      conversionPercent: 0,
    });
  });

  it("toggles conversion via POST and PATCH and sets conversionDate", async () => {
    const { app } = testApp();
    const a = await register(app, "convtoggle");
    const created = await a.agent.post("/api/patients").send({
      name: "Pat Convert",
      day1Date: "2026-09-15",
    });
    const id = created.body.patient.id as string;

    const on = await a.agent
      .post(`/api/patients/${id}/conversion`)
      .send({ converted: true });
    expect(on.status).toBe(200);
    expect(on.body.patient.converted).toBe(true);
    expect(on.body.patient.conversionDate).toBe("2026-09-16");

    const off = await a.agent.patch(`/api/patients/${id}`).send({ converted: false });
    expect(off.status).toBe(200);
    expect(off.body.patient.converted).toBe(false);
    expect(off.body.patient.conversionDate).toBeNull();
  });

  it("encrypts notes at rest and omits names from audit metadata", async () => {
    const { app, storage } = testApp();
    const a = await register(app, "patenc");
    const created = await a.agent.post("/api/patients").send({
      name: "Named Patient",
      notes: "clinical aside",
      day1Date: "2026-09-16",
    });
    expect(created.status).toBe(201);
    const raw = storage.patients[0];
    expect(raw.notes).toBeTruthy();
    expect(isAesGcmCiphertext(raw.notes!)).toBe(true);
    expect(raw.notes).not.toContain("clinical aside");

    const logs = await a.agent.get("/api/audit-logs");
    expect(logs.status).toBe(200);
    const create = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "patient" && row.action === "create",
    );
    expect(create).toBeTruthy();
    expect(JSON.stringify(create)).not.toContain("Named Patient");
    expect(JSON.stringify(create)).not.toContain("clinical aside");
    expect(create.resourceId).toBe(created.body.patient.id);
  });

  it("staff can create patients; owner can delete", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "stafffunnel");
    const hash = (await storage.getUserByUsername("user_stafffunnel"))!;
    const staffUser = await storage.createUser({
      email: "stafffunnel@clinic.test",
      username: "stafffunnel",
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
    const staff = request.agent(app);
    await staff.post("/api/auth/login").send({
      login: "stafffunnel",
      password: STRONG,
    });
    const created = await staff.post("/api/patients").send({ name: "Staff Patient" });
    expect(created.status).toBe(201);
    const denied = await staff.delete(`/api/patients/${created.body.patient.id}`);
    expect(denied.status).toBe(403);
    const deleted = await owner.agent.delete(
      `/api/patients/${created.body.patient.id}`,
    );
    expect(deleted.status).toBe(200);
  });
});

describe("Dashboard new-patient availability", () => {
  it("stays unavailable until a patient exists, then uses real counts", async () => {
    const { app } = testApp();
    const a = await register(app, "dashpat");

    const empty = await a.agent.get("/api/dashboard?period=this_week");
    expect(empty.status).toBe(200);
    expect(empty.body.kpis.newPatients.available).toBe(false);
    expect(empty.body.kpis.conversion.available).toBe(false);
    expect(empty.body.kpis.wellnessPatients.available).toBe(false);

    await a.agent.post("/api/patients").send({
      name: "New This Week",
      patientType: "new",
      day1Date: "2026-09-15",
      converted: true,
      conversionDate: "2026-09-16",
      referralSource: "Google",
    });
    await a.agent.post("/api/patients").send({
      name: "New Unconverted",
      patientType: "new",
      day1Date: "2026-09-16",
    });
    await a.agent.post("/api/patients").send({
      name: "Wellness Visit",
      patientType: "wellness",
      day1Date: "2026-09-16",
    });
    await a.agent.post("/api/patients").send({
      name: "Prior Period",
      patientType: "new",
      day1Date: "2026-09-12",
      converted: true,
    });

    const filled = await a.agent.get("/api/dashboard?period=this_week");
    expect(filled.body.kpis.newPatients.available).toBe(true);
    expect(filled.body.kpis.newPatients.value).toBe(2);
    expect(filled.body.kpis.newPatients.previousValue).toBe(1);
    expect(filled.body.kpis.wellnessPatients.available).toBe(true);
    expect(filled.body.kpis.wellnessPatients.value).toBe(1);
    expect(filled.body.kpis.conversion.available).toBe(true);
    expect(filled.body.kpis.conversion.newCount).toBe(2);
    expect(filled.body.kpis.conversion.convertedCount).toBe(1);
    expect(filled.body.kpis.conversion.value).toBe(50);
    expect(filled.body.kpis.conversion.formula).toMatch(/converted \/ new/);
  });
});
