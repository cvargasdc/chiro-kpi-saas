import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { createMemoryStorage } from "../server/storage/memory";

const STRONG = "CorrectHorse-Battery9!";
const SESSION_SECRET = "test-session-secret-not-for-production";

function testApp() {
  const storage = createMemoryStorage();
  const app = createApp({
    storage,
    session: {
      secret: SESSION_SECRET,
      secure: false,
      sameSite: "lax",
      trustProxy: false,
    },
  });
  return { app, storage };
}

async function register(
  app: ReturnType<typeof createApp>,
  suffix: string,
) {
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

describe("API tenant isolation", () => {
  it("health is public", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.path).toBe("B");
    expect(res.body.openai).toBe(false);
  });

  it("Practice A cannot list or fetch Practice B patients over HTTP", async () => {
    const { app } = testApp();
    const a = await register(app, "alpha");
    const b = await register(app, "bravo");

    const createdB = await b.agent.post("/api/patients").send({ name: "Bob from B" });
    expect(createdB.status).toBe(201);
    const bobId = createdB.body.patient.id;

    const listA = await a.agent.get("/api/patients");
    expect(listA.status).toBe(200);
    expect(listA.body.patients).toEqual([]);

    const createdA = await a.agent.post("/api/patients").send({ name: "Alice from A" });
    expect(createdA.status).toBe(201);

    const listA2 = await a.agent.get("/api/patients");
    expect(listA2.body.patients.map((p: { name: string }) => p.name)).toEqual([
      "Alice from A",
    ]);

    const steal = await a.agent.get(`/api/patients/${bobId}`);
    expect(steal.status).toBe(404);

    const stealByHeader = await a.agent
      .get("/api/patients")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(stealByHeader.status).toBe(403);
  });

  it("readonly members cannot create patients", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "clinic");
    const hash = (await storage.getUserByUsername("user_clinic"))!;

    const staff = await storage.createUser({
      email: "reader@clinic.test",
      username: "reader",
      passwordHash: hash.passwordHash,
      displayName: "Read Only",
    });
    await storage.createOrgMembership({
      orgId: owner.body.organization.id,
      userId: staff.id,
      role: "readonly",
    });
    await storage.createPracticeMembership({
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      userId: staff.id,
      role: "readonly",
    });

    const reader = request.agent(app);
    const login = await reader.post("/api/auth/login").send({
      login: "reader",
      password: STRONG,
    });
    expect(login.status).toBe(200);

    const denied = await reader.post("/api/patients").send({ name: "Should Fail" });
    expect(denied.status).toBe(403);

    const allowedRead = await reader.get("/api/patients");
    expect(allowedRead.status).toBe(200);
  });

  it("import routes are stubs (no parser, no OpenAI)", async () => {
    const { app } = testApp();
    const a = await register(app, "import");
    const res = await a.agent.post("/api/import").send({});
    expect(res.status).toBe(501);
    expect(res.body.openai).toBe(false);
    expect(res.body.chirotouch).toBe(false);
  });

  it("rejects weak passwords", async () => {
    const { app } = testApp();
    const res = await request(app).post("/api/auth/register").send({
      email: "weak@clinic.test",
      username: "weakuser",
      password: "short",
      displayName: "Weak",
      organizationName: "Org",
      practiceName: "Practice",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("password_policy");
  });

  it("me requires a session", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
  });
});
