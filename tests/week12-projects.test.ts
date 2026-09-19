import { describe, expect, it } from "vitest";
import request from "supertest";
import { isAesGcmCiphertext } from "../server/crypto/aes-gcm";
import { createApp } from "../server/app";
import { createMemoryStorage } from "../server/storage/memory";
import { projectCompletionPercent } from "../shared/projects";

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

describe("project completion math", () => {
  it("is done / total, 0 when there are no tasks, nearest integer", () => {
    expect(projectCompletionPercent(0, 0)).toBe(0);
    expect(projectCompletionPercent(0, 4)).toBe(0);
    expect(projectCompletionPercent(1, 2)).toBe(50);
    expect(projectCompletionPercent(1, 3)).toBe(33);
    expect(projectCompletionPercent(2, 3)).toBe(67);
    expect(projectCompletionPercent(3, 3)).toBe(100);
    expect(projectCompletionPercent(5, 4)).toBe(100);
  });
});

describe("Projects APIs", () => {
  it("creates a project with default columns and reports completion percent", async () => {
    const { app } = testApp();
    const a = await register(app, "prjcreate");

    const empty = await a.agent.get("/api/projects");
    expect(empty.status).toBe(200);
    expect(empty.body.emptyState).toBe("no_projects");
    expect(empty.body.projects).toEqual([]);
    expect(empty.body.templates).toEqual([]);
    expect(empty.body.feature.ghlWebhook).toBe(false);

    const created = await a.agent.post("/api/projects").send({
      name: "Front desk refresh",
      description: "Ops only",
      tags: "ops, front-desk",
    });
    expect(created.status).toBe(201);
    expect(created.body.project.status).toBe("active");
    expect(created.body.project.tags).toEqual(["ops", "front-desk"]);
    expect(created.body.project.columns.map((c: { name: string }) => c.name)).toEqual([
      "Todo",
      "Doing",
      "Done",
    ]);
    expect(created.body.project.completionPercent).toBe(0);
    expect(created.body.project.taskCount).toBe(0);

    const projectId = created.body.project.id as string;
    const todoId = created.body.project.columns[0].id as string;
    const doingId = created.body.project.columns[1].id as string;

    const t1 = await a.agent.post(`/api/projects/${projectId}/tasks`).send({
      title: "Order forms",
      columnId: todoId,
    });
    expect(t1.status).toBe(201);
    const t2 = await a.agent.post(`/api/projects/${projectId}/tasks`).send({
      title: "Train staff",
      columnId: todoId,
    });
    expect(t2.status).toBe(201);

    const listed = await a.agent.get("/api/projects");
    expect(listed.body.emptyState).toBe("has_data");
    expect(listed.body.projects[0].taskCount).toBe(2);
    expect(listed.body.projects[0].doneCount).toBe(0);
    expect(listed.body.projects[0].completionPercent).toBe(0);

    const toggled = await a.agent
      .post(`/api/project-tasks/${t1.body.task.id}/toggle`)
      .send({});
    expect(toggled.status).toBe(200);
    expect(toggled.body.task.done).toBe(true);

    const moved = await a.agent
      .post(`/api/project-tasks/${t2.body.task.id}/move`)
      .send({ columnId: doingId });
    expect(moved.status).toBe(200);
    expect(moved.body.task.columnId).toBe(doingId);

    const after = await a.agent.get(`/api/projects/${projectId}`);
    expect(after.body.project.doneCount).toBe(1);
    expect(after.body.project.taskCount).toBe(2);
    expect(after.body.project.completionPercent).toBe(50);
    expect(after.body.project.columns[1].tasks[0].id).toBe(t2.body.task.id);
  });

  it("duplicates a template into an active project with copied tasks", async () => {
    const { app, storage } = testApp({ phiEncryptionKey: PHI_KEY });
    const a = await register(app, "prjdup");

    const template = await a.agent.post("/api/projects").send({
      name: "New-hire onboarding",
      status: "template",
    });
    expect(template.status).toBe(201);
    expect(template.body.project.status).toBe("template");
    const templateId = template.body.project.id as string;
    const todoId = template.body.project.columns[0].id as string;

    const secretNote = "Ask Jane Doe about lumbar follow-up";
    const task = await a.agent.post(`/api/projects/${templateId}/tasks`).send({
      title: "Send welcome packet",
      columnId: todoId,
      notes: secretNote,
      dueDate: "2026-09-20",
      assigneeName: "Front desk",
    });
    expect(task.status).toBe(201);
    expect(task.body.task.notes).toBe(secretNote);

    const raw = storage.projectTasks[0];
    expect(raw.notes).toBeTruthy();
    expect(isAesGcmCiphertext(raw.notes!)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("Jane Doe");
    expect(JSON.stringify(raw)).not.toContain(secretNote);

    const list = await a.agent.get("/api/projects");
    expect(list.body.projects).toEqual([]);
    expect(list.body.templates).toHaveLength(1);
    expect(list.body.templates[0].id).toBe(templateId);
    expect(list.body.emptyState).toBe("no_projects");

    const duplicated = await a.agent
      .post(`/api/projects/${templateId}/duplicate`)
      .send({});
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.project.status).toBe("active");
    expect(duplicated.body.project.name).toBe("New-hire onboarding");
    expect(duplicated.body.project.id).not.toBe(templateId);
    expect(duplicated.body.duplicatedFrom).toBe(templateId);
    const copiedTasks = duplicated.body.project.columns.flatMap(
      (col: { tasks: Array<{ title: string; notes: string | null; id: string }> }) =>
        col.tasks,
    );
    expect(copiedTasks).toHaveLength(1);
    expect(copiedTasks[0].title).toBe("Send welcome packet");
    expect(copiedTasks[0].notes).toBe(secretNote);
    expect(copiedTasks[0].id).not.toBe(task.body.task.id);

    const afterList = await a.agent.get("/api/projects");
    expect(afterList.body.emptyState).toBe("has_data");
    expect(afterList.body.projects).toHaveLength(1);
    expect(afterList.body.templates).toHaveLength(1);
    expect(JSON.stringify(afterList.body.projects[0])).not.toContain("Jane Doe");

    const logs = await a.agent.get("/api/audit-logs");
    expect(JSON.stringify(logs.body)).not.toContain("Jane Doe");
    expect(JSON.stringify(logs.body)).not.toContain(secretNote);
    expect(JSON.stringify(logs.body)).not.toContain("Send welcome packet");
  });

  it("Practice A cannot list, fetch, or mutate Practice B projects", async () => {
    const { app } = testApp();
    const a = await register(app, "prja");
    const b = await register(app, "prjb");

    const createdB = await b.agent.post("/api/projects").send({
      name: "B secret board",
    });
    expect(createdB.status).toBe(201);
    const bid = createdB.body.project.id as string;
    const colB = createdB.body.project.columns[0].id as string;
    const taskB = await b.agent.post(`/api/projects/${bid}/tasks`).send({
      title: "B only task",
      columnId: colB,
    });
    const taskId = taskB.body.task.id as string;

    const listA = await a.agent.get("/api/projects");
    expect(listA.body.projects).toEqual([]);
    expect(JSON.stringify(listA.body)).not.toContain("B secret board");
    expect((await a.agent.get(`/api/projects/${bid}`)).status).toBe(404);
    expect(
      (await a.agent.patch(`/api/projects/${bid}`).send({ name: "x" })).status,
    ).toBe(404);
    expect((await a.agent.delete(`/api/projects/${bid}`)).status).toBe(404);
    expect(
      (await a.agent.post(`/api/projects/${bid}/tasks`).send({ title: "nope" }))
        .status,
    ).toBe(404);
    expect(
      (await a.agent.post(`/api/project-tasks/${taskId}/toggle`).send({})).status,
    ).toBe(404);
    expect(
      (await a.agent.post(`/api/projects/${bid}/duplicate`).send({})).status,
    ).toBe(404);

    const header = await a.agent
      .get("/api/projects")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("readonly cannot create; staff cannot archive or delete", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "prjrbac");
    const created = await owner.agent.post("/api/projects").send({
      name: "Keep board",
    });
    expect(created.status).toBe(201);
    const id = created.body.project.id as string;
    const ownerUser = (await storage.getUserByUsername("user_prjrbac"))!;

    const readerUser = await storage.createUser({
      email: "readerprj@clinic.test",
      username: "readerprj",
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
      email: "staffprj@clinic.test",
      username: "staffprj",
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
      (
        await reader
          .post("/api/auth/login")
          .send({ login: "readerprj", password: STRONG })
      ).status,
    ).toBe(200);
    expect((await reader.get("/api/projects")).status).toBe(200);
    expect((await reader.get(`/api/projects/${id}`)).status).toBe(200);
    expect(
      (await reader.post("/api/projects").send({ name: "Nope" })).status,
    ).toBe(403);
    expect(
      (await reader.post(`/api/projects/${id}/tasks`).send({ title: "Nope" }))
        .status,
    ).toBe(403);
    expect((await reader.delete(`/api/projects/${id}`)).status).toBe(403);

    const staff = request.agent(app);
    expect(
      (
        await staff
          .post("/api/auth/login")
          .send({ login: "staffprj", password: STRONG })
      ).status,
    ).toBe(200);
    const written = await staff.post("/api/projects").send({
      name: "Staff board",
    });
    expect(written.status).toBe(201);
    const staffId = written.body.project.id as string;
    const task = await staff
      .post(`/api/projects/${staffId}/tasks`)
      .send({ title: "Staff task" });
    expect(task.status).toBe(201);
    expect(
      (await staff.post(`/api/projects/${staffId}/archive`).send({})).status,
    ).toBe(403);
    expect(
      (await staff.patch(`/api/projects/${staffId}`).send({ status: "archived" }))
        .status,
    ).toBe(403);
    expect((await staff.delete(`/api/projects/${staffId}`)).status).toBe(403);
    expect(
      (await owner.agent.post(`/api/projects/${staffId}/archive`).send({})).status,
    ).toBe(200);
  });

  it("GHL webhook ingress is a 501 stub", async () => {
    const { app } = testApp();
    const a = await register(app, "prjghl");
    const res = await a.agent.post("/api/ghl/webhook").send({ contact: "Jane" });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("not_implemented");
    expect(res.body.ghl).toBe(false);
    expect(res.body.openai).toBe(false);
  });
});
