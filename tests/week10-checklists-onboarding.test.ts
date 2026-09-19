import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { createMemoryStorage } from "../server/storage/memory";
import { isAesGcmCiphertext } from "../server/crypto/aes-gcm";
import {
  buildTodayView,
  completionDateForCadence,
} from "../shared/practice-checklists";
import { deriveChecklistStatus } from "../shared/onboarding";

const STRONG = "CorrectHorse-Battery9!";
const SESSION_SECRET = "test-session-secret-not-for-production";
const NOW = new Date("2026-09-16T12:00:00.000Z");
const PHI_KEY = "test-phi-encryption-key-min-32-chars!!";

function testApp(opts?: { phiEncryptionKey?: string }) {
  const storage = createMemoryStorage({
    phiEncryptionKey: opts?.phiEncryptionKey,
  });
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

describe("practice vs onboarding helpers", () => {
  it("weekly completions key off Monday of the UTC week", () => {
    expect(completionDateForCadence("daily", "2026-09-16")).toBe("2026-09-16");
    expect(completionDateForCadence("weekly", "2026-09-16")).toBe("2026-09-14");
  });

  it("today view counts only active items and completions for the period", () => {
    const view = buildTodayView({
      date: "2026-09-16",
      checklists: [
        { id: "c1", name: "Open", cadence: "daily", active: true },
        { id: "c2", name: "Week", cadence: "weekly", active: true },
      ],
      items: [
        {
          id: "i1",
          checklistId: "c1",
          title: "Lights",
          category: "Opening",
          sortOrder: 0,
          active: true,
        },
        {
          id: "i2",
          checklistId: "c2",
          title: "Inventory",
          category: "Admin",
          sortOrder: 0,
          active: true,
        },
      ],
      completions: [
        {
          itemId: "i1",
          completedOn: "2026-09-16",
          completed: true,
          completedBy: "u1",
        },
        {
          itemId: "i2",
          completedOn: "2026-09-14",
          completed: true,
          completedBy: "u1",
        },
      ],
    });
    expect(view.progress).toEqual({ done: 2, total: 2 });
    expect(view.checklists[1].periodDate).toBe("2026-09-14");
  });

  it("derives onboarding status from task completion", () => {
    expect(deriveChecklistStatus([])).toBe("not_started");
    expect(deriveChecklistStatus([{ done: false }])).toBe("not_started");
    expect(deriveChecklistStatus([{ done: true }, { done: false }])).toBe(
      "in_progress",
    );
    expect(deriveChecklistStatus([{ done: true }, { done: true }])).toBe(
      "complete",
    );
  });
});

describe("Practice Checklists APIs", () => {
  it("creates a daily list, toggles today, and reports X/Y progress", async () => {
    const { app } = testApp();
    const a = await register(app, "pclcreate");

    const empty = await a.agent.get("/api/practice-checklists/today");
    expect(empty.status).toBe(200);
    expect(empty.body.emptyState).toBe("no_checklists");
    expect(empty.body.progress).toEqual({ done: 0, total: 0 });
    expect(empty.body.feature.onboarding).toBe(false);

    const created = await a.agent.post("/api/practice-checklists").send({
      name: "Opening routine",
      cadence: "daily",
    });
    expect(created.status).toBe(201);
    const cid = created.body.checklist.id as string;

    await a.agent.post(`/api/practice-checklists/${cid}/items`).send({
      title: "Unlock door",
      category: "opening",
    });
    await a.agent.post(`/api/practice-checklists/${cid}/items`).send({
      title: "Start music",
      category: "Front desk",
    });

    const today = await a.agent.get("/api/practice-checklists/today");
    expect(today.body.emptyState).toBe("has_data");
    expect(today.body.progress).toEqual({ done: 0, total: 2 });
    const itemId = today.body.checklists[0].items[0].id as string;

    const toggled = await a.agent
      .post(`/api/practice-checklist-items/${itemId}/toggle`)
      .send({});
    expect(toggled.status).toBe(200);
    expect(toggled.body.completion.completed).toBe(true);
    expect(toggled.body.completion.completedOn).toBe("2026-09-16");

    const after = await a.agent.get("/api/practice-checklists/today");
    expect(after.body.progress).toEqual({ done: 1, total: 2 });

    const history = await a.agent.get("/api/practice-checklists/history");
    expect(history.status).toBe(200);
    expect(history.body.days).toHaveLength(14);
    const todayRow = history.body.days.find(
      (d: { date: string }) => d.date === "2026-09-16",
    );
    expect(todayRow.progress).toEqual({ done: 1, total: 2 });
  });

  it("weekly toggle stores Monday as completedOn", async () => {
    const { app } = testApp();
    const a = await register(app, "pclweek");
    const created = await a.agent.post("/api/practice-checklists").send({
      name: "Weekly ops",
      cadence: "weekly",
    });
    const item = await a.agent
      .post(`/api/practice-checklists/${created.body.checklist.id}/items`)
      .send({ title: "Order supplies", category: "Admin" });
    const toggled = await a.agent
      .post(`/api/practice-checklist-items/${item.body.item.id}/toggle`)
      .send({ date: "2026-09-16" });
    expect(toggled.body.completion.completedOn).toBe("2026-09-14");
  });

  it("Practice A cannot list, fetch, or mutate Practice B checklists", async () => {
    const { app } = testApp();
    const a = await register(app, "pcla");
    const b = await register(app, "pclb");

    const createdB = await b.agent.post("/api/practice-checklists").send({
      name: "B only opening",
      cadence: "daily",
    });
    expect(createdB.status).toBe(201);
    const bid = createdB.body.checklist.id as string;
    const itemB = await b.agent
      .post(`/api/practice-checklists/${bid}/items`)
      .send({ title: "B secret", category: "Admin" });
    const itemId = itemB.body.item.id as string;

    const listA = await a.agent.get("/api/practice-checklists");
    expect(listA.body.checklists).toEqual([]);
    expect(JSON.stringify(listA.body)).not.toContain("B only opening");
    expect((await a.agent.get(`/api/practice-checklists/${bid}`)).status).toBe(
      404,
    );
    expect(
      (await a.agent.patch(`/api/practice-checklists/${bid}`).send({ name: "x" }))
        .status,
    ).toBe(404);
    expect((await a.agent.delete(`/api/practice-checklists/${bid}`)).status).toBe(
      404,
    );
    expect(
      (
        await a.agent
          .post(`/api/practice-checklist-items/${itemId}/toggle`)
          .send({})
      ).status,
    ).toBe(404);

    const header = await a.agent
      .get("/api/practice-checklists")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("readonly is GET-only; staff can write but not delete checklists", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "pclro");
    const created = await owner.agent.post("/api/practice-checklists").send({
      name: "Keep",
      cadence: "daily",
    });
    const id = created.body.checklist.id as string;
    const ownerUser = (await storage.getUserByUsername("user_pclro"))!;

    const readerUser = await storage.createUser({
      email: "readerpcl@clinic.test",
      username: "readerpcl",
      passwordHash: ownerUser.passwordHash,
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
    const staffUser = await storage.createUser({
      email: "staffpcl@clinic.test",
      username: "staffpcl",
      passwordHash: ownerUser.passwordHash,
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

    const reader = request.agent(app);
    expect(
      (await reader.post("/api/auth/login").send({ login: "readerpcl", password: STRONG }))
        .status,
    ).toBe(200);
    expect((await reader.get("/api/practice-checklists")).status).toBe(200);
    expect((await reader.get("/api/practice-checklists/today")).status).toBe(200);
    expect(
      (await reader.post("/api/practice-checklists").send({ name: "Nope", cadence: "daily" }))
        .status,
    ).toBe(403);
    expect((await reader.delete(`/api/practice-checklists/${id}`)).status).toBe(
      403,
    );

    const staff = request.agent(app);
    expect(
      (await staff.post("/api/auth/login").send({ login: "staffpcl", password: STRONG }))
        .status,
    ).toBe(200);
    const written = await staff.post("/api/practice-checklists").send({
      name: "Staff list",
      cadence: "weekly",
    });
    expect(written.status).toBe(201);
    expect(
      (await staff.delete(`/api/practice-checklists/${written.body.checklist.id}`))
        .status,
    ).toBe(403);
    expect((await owner.agent.delete(`/api/practice-checklists/${id}`)).status).toBe(
      200,
    );
  });
});

describe("Patient Onboarding APIs", () => {
  it("assigning a template copies tasks onto the patient checklist", async () => {
    const { app, storage } = testApp({ phiEncryptionKey: PHI_KEY });
    const a = await register(app, "onbassign");

    const patient = await a.agent.post("/api/patients").send({
      name: "Casey Spine",
      patientType: "new",
    });
    expect(patient.status).toBe(201);
    const patientId = patient.body.patient.id as string;

    const template = await a.agent.post("/api/onboarding/templates").send({
      name: "New patient Day-1",
      patientType: "new",
      tasks: [
        { title: "Intake forms" },
        { title: "Exam" },
        { title: "Care plan walkthrough" },
      ],
    });
    expect(template.status).toBe(201);
    expect(template.body.template.tasks).toHaveLength(3);
    expect(template.body.feature.practiceChecklists).toBe(false);

    const assigned = await a.agent.post("/api/onboarding/patient-checklists").send({
      patientId,
      templateId: template.body.template.id,
      notes: "Prefers morning visits",
    });
    expect(assigned.status).toBe(201);
    expect(assigned.body.checklist.tasks).toHaveLength(3);
    expect(assigned.body.checklist.tasks.map((t: { title: string }) => t.title)).toEqual([
      "Intake forms",
      "Exam",
      "Care plan walkthrough",
    ]);
    expect(assigned.body.checklist.status).toBe("not_started");
    expect(assigned.body.checklist.doneCount).toBe(0);
    expect(assigned.body.checklist.notes).toBe("Prefers morning visits");

    const raw = storage.patientChecklists[0];
    expect(raw.notes).toBeTruthy();
    expect(isAesGcmCiphertext(raw.notes!)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("Prefers morning visits");

    const taskId = assigned.body.checklist.tasks[0].id as string;
    const toggled = await a.agent
      .post(
        `/api/onboarding/patient-checklists/${assigned.body.checklist.id}/tasks/${taskId}/toggle`,
      )
      .send({ done: true });
    expect(toggled.status).toBe(200);
    expect(toggled.body.checklist.status).toBe("in_progress");
    expect(toggled.body.checklist.doneCount).toBe(1);

    const profile = await a.agent.get(`/api/patients/${patientId}`);
    expect(profile.body.patient.onboarding.available).toBe(true);
    expect(profile.body.patient.onboarding.assigned).toBe(true);
    expect(profile.body.patient.onboarding.checklists[0].doneCount).toBe(1);
    expect(JSON.stringify(profile.body.patient.onboarding)).not.toContain(
      "Casey Spine",
    );

    const dash = await a.agent.get("/api/dashboard?period=this_week");
    expect(dash.body.onboarding.available).toBe(true);
    expect(dash.body.onboarding.incompleteCount).toBe(1);
    expect(dash.body.onboarding.emptyState).toBe("has_incomplete");
  });

  it("Practice A cannot read Practice B templates or patient checklists", async () => {
    const { app } = testApp();
    const a = await register(app, "onba");
    const b = await register(app, "onbb");

    const patientB = await b.agent.post("/api/patients").send({ name: "Bob B" });
    const templateB = await b.agent.post("/api/onboarding/templates").send({
      name: "B secret template",
      tasks: [{ title: "B only task" }],
    });
    const assignedB = await b.agent.post("/api/onboarding/patient-checklists").send({
      patientId: patientB.body.patient.id,
      templateId: templateB.body.template.id,
    });
    const tid = templateB.body.template.id as string;
    const cid = assignedB.body.checklist.id as string;

    const listA = await a.agent.get("/api/onboarding/templates");
    expect(listA.body.templates).toEqual([]);
    expect(JSON.stringify(listA.body)).not.toContain("B secret template");
    expect((await a.agent.get(`/api/onboarding/templates/${tid}`)).status).toBe(
      404,
    );
    expect(
      (await a.agent.get(`/api/onboarding/patient-checklists/${cid}`)).status,
    ).toBe(404);
    expect(
      (
        await a.agent.post("/api/onboarding/patient-checklists").send({
          patientId: patientB.body.patient.id,
          templateId: tid,
        })
      ).status,
    ).toBe(404);

    const header = await a.agent
      .get("/api/onboarding/templates")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("readonly is GET-only on onboarding; staff can assign", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "onbro");
    const patient = await owner.agent.post("/api/patients").send({
      name: "Keep Patient",
    });
    const template = await owner.agent.post("/api/onboarding/templates").send({
      name: "Keep template",
      tasks: [{ title: "Welcome" }],
    });
    const ownerUser = (await storage.getUserByUsername("user_onbro"))!;

    const readerUser = await storage.createUser({
      email: "readeronb@clinic.test",
      username: "readeronb",
      passwordHash: ownerUser.passwordHash,
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
    const staffUser = await storage.createUser({
      email: "staffonb@clinic.test",
      username: "staffonb",
      passwordHash: ownerUser.passwordHash,
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

    const reader = request.agent(app);
    expect(
      (await reader.post("/api/auth/login").send({ login: "readeronb", password: STRONG }))
        .status,
    ).toBe(200);
    expect((await reader.get("/api/onboarding/templates")).status).toBe(200);
    expect((await reader.get("/api/onboarding/patient-checklists")).status).toBe(
      200,
    );
    expect(
      (
        await reader.post("/api/onboarding/templates").send({
          name: "Nope",
          tasks: [{ title: "x" }],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await reader.post("/api/onboarding/patient-checklists").send({
          patientId: patient.body.patient.id,
          templateId: template.body.template.id,
        })
      ).status,
    ).toBe(403);

    const staff = request.agent(app);
    expect(
      (await staff.post("/api/auth/login").send({ login: "staffonb", password: STRONG }))
        .status,
    ).toBe(200);
    const assigned = await staff.post("/api/onboarding/patient-checklists").send({
      patientId: patient.body.patient.id,
      templateId: template.body.template.id,
    });
    expect(assigned.status).toBe(201);
    expect(assigned.body.checklist.tasks).toHaveLength(1);
    expect(
      (await staff.delete(`/api/onboarding/patient-checklists/${assigned.body.checklist.id}`))
        .status,
    ).toBe(403);
  });

  it("audit metadata for onboarding has no patient names", async () => {
    const { app, storage } = testApp();
    const a = await register(app, "onbaudit");
    const patient = await a.agent.post("/api/patients").send({
      name: "Secret Patient",
    });
    const template = await a.agent.post("/api/onboarding/templates").send({
      name: "Day one",
      tasks: [{ title: "Forms" }],
    });
    await a.agent.post("/api/onboarding/patient-checklists").send({
      patientId: patient.body.patient.id,
      templateId: template.body.template.id,
      notes: "do not leak",
    });
    const logs = storage.auditLogs.filter(
      (row) => row.resourceType === "patient_checklist",
    );
    expect(logs.length).toBeGreaterThan(0);
    const blob = JSON.stringify(logs);
    expect(blob).not.toContain("Secret Patient");
    expect(blob).not.toContain("do not leak");
  });
});
