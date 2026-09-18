import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { generateTotpCode } from "../server/auth/totp";
import { InMemoryMailer } from "../server/mailer/memory";
import { createMemoryStorage } from "../server/storage/memory";
import type { MemoryStorage } from "../server/storage/memory";

const STRONG = "CorrectHorse-Battery9!";
const STRONG2 = "CorrectHorse-Battery8!";
const SESSION_SECRET = "test-session-secret-not-for-production";
const MFA_KEY = "test-mfa-encryption-key-min-32-chars!!";

function tokenFromMailer(mailer: InMemoryMailer, template: string): string {
  const msg = [...mailer.outbox].reverse().find((m) => m.template === template);
  expect(msg?.actionUrl).toBeTruthy();
  const url = new URL(msg!.actionUrl!);
  const token = url.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

function testApp(opts?: { now?: () => Date; storage?: MemoryStorage }) {
  const storage = opts?.storage ?? createMemoryStorage();
  const mailer = new InMemoryMailer();
  const app = createApp({
    storage,
    mailer,
    mfaEncryptionKey: MFA_KEY,
    publicBaseUrl: "http://localhost:5000",
    now: opts?.now,
    session: {
      secret: SESSION_SECRET,
      secure: false,
      sameSite: "lax",
      trustProxy: false,
    },
  });
  return { app, storage, mailer };
}

async function register(
  app: ReturnType<typeof createApp>,
  suffix: string,
  password = STRONG,
) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({
    email: `${suffix}@clinic.test`,
    username: `user_${suffix}`,
    password,
    displayName: `Owner ${suffix}`,
    organizationName: `Org ${suffix}`,
    practiceName: `Practice ${suffix}`,
  });
  expect(res.status).toBe(201);
  return { agent, body: res.body };
}

async function addMember(
  storage: MemoryStorage,
  opts: {
    email: string;
    username: string;
    role: "readonly" | "staff" | "clinician" | "admin";
    orgId: string;
    practiceId: string;
    passwordHash: string;
  },
) {
  const user = await storage.createUser({
    email: opts.email,
    username: opts.username,
    passwordHash: opts.passwordHash,
    displayName: opts.username,
  });
  await storage.createOrgMembership({
    orgId: opts.orgId,
    userId: user.id,
    role: opts.role,
  });
  await storage.createPracticeMembership({
    orgId: opts.orgId,
    practiceId: opts.practiceId,
    userId: user.id,
    role: opts.role,
  });
  return user;
}

describe("password reset", () => {
  it("forgot-password always returns a generic success message", async () => {
    const { app, mailer } = testApp();
    const known = await request(app).post("/api/auth/forgot-password").send({
      email: "nobody@clinic.test",
    });
    expect(known.status).toBe(200);
    expect(known.body.message).toMatch(/if an account exists/i);
    expect(mailer.outbox).toHaveLength(0);

    await register(app, "resetme");
    const sent = await request(app).post("/api/auth/forgot-password").send({
      email: "resetme@clinic.test",
    });
    expect(sent.status).toBe(200);
    expect(sent.body.message).toBe(known.body.message);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0].template).toBe("password_reset");
  });

  it("reset-password happy path updates the password and invalidates old sessions", async () => {
    const { app, storage, mailer } = testApp();
    const owner = await register(app, "happy");
    const stillAuthed = await owner.agent.get("/api/me");
    expect(stillAuthed.status).toBe(200);

    await request(app).post("/api/auth/forgot-password").send({
      email: "happy@clinic.test",
    });
    const token = tokenFromMailer(mailer, "password_reset");

    const reset = await request(app).post("/api/auth/reset-password").send({
      token,
      password: STRONG2,
    });
    expect(reset.status).toBe(200);

    const oldSession = await owner.agent.get("/api/me");
    expect(oldSession.status).toBe(401);

    const oldLogin = await request(app).post("/api/auth/login").send({
      login: "happy@clinic.test",
      password: STRONG,
    });
    expect(oldLogin.status).toBe(401);

    const fresh = request.agent(app);
    const newLogin = await fresh.post("/api/auth/login").send({
      login: "happy@clinic.test",
      password: STRONG2,
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mfaRequired).toBe(false);

    const logs = await storage.listAuditLogs({
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
    });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("password_reset_requested");
    expect(actions).toContain("password_reset_completed");
    for (const row of logs.filter((l) => l.action.startsWith("password_reset"))) {
      expect(JSON.stringify(row.metadata ?? {})).not.toMatch(/clinic\.test/);
      expect(JSON.stringify(row.metadata ?? {})).not.toMatch(/token/i);
    }
  });

  it("rejects an expired reset token", async () => {
    let current = new Date("2026-03-01T00:00:00Z");
    const { app, mailer } = testApp({ now: () => current });
    await register(app, "expired");
    await request(app).post("/api/auth/forgot-password").send({
      email: "expired@clinic.test",
    });
    const token = tokenFromMailer(mailer, "password_reset");
    current = new Date("2026-03-01T02:00:00Z");
    const reset = await request(app).post("/api/auth/reset-password").send({
      token,
      password: STRONG2,
    });
    expect(reset.status).toBe(400);
    expect(reset.body.error).toBe("invalid_or_expired_token");
  });

  it("rejects a weak reset password", async () => {
    const { app, mailer } = testApp();
    await register(app, "weakpw");
    await request(app).post("/api/auth/forgot-password").send({
      email: "weakpw@clinic.test",
    });
    const token = tokenFromMailer(mailer, "password_reset");
    const reset = await request(app).post("/api/auth/reset-password").send({
      token,
      password: "short",
    });
    expect(reset.status).toBe(400);
    expect(reset.body.error).toBe("password_policy");
  });
});

describe("practice invites", () => {
  it("owner invites, invitee accepts, membership is created", async () => {
    const { app, storage, mailer } = testApp();
    const owner = await register(app, "clinic");
    const practiceId = owner.body.practice.id as string;

    const created = await owner.agent
      .post(`/api/practices/${practiceId}/invites`)
      .send({ email: "newhire@clinic.test", role: "staff" });
    expect(created.status).toBe(201);
    expect(created.body.invite.email).toBe("newhire@clinic.test");

    const listed = await owner.agent.get(`/api/practices/${practiceId}/invites`);
    expect(listed.status).toBe(200);
    expect(listed.body.invites).toHaveLength(1);

    const token = tokenFromMailer(mailer, "practice_invite");
    const accept = await request(app).post("/api/invites/accept").send({
      token,
      password: STRONG,
      username: "newhire",
      displayName: "New Hire",
    });
    expect(accept.status).toBe(200);
    expect(accept.body.practice.role).toBe("staff");

    const membership = await storage.getPracticeMembership(
      accept.body.user.id,
      practiceId,
    );
    expect(membership?.role).toBe("staff");
    expect(membership?.status).toBe("active");

    const pending = await owner.agent.get(`/api/practices/${practiceId}/invites`);
    expect(pending.body.invites).toHaveLength(0);

    const logs = await storage.listAuditLogs({
      orgId: owner.body.organization.id,
      practiceId,
    });
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(["invite_created", "invite_accepted"]),
    );
  });

  it("owner can revoke a pending invite", async () => {
    const { app, mailer } = testApp();
    const owner = await register(app, "revoke");
    const practiceId = owner.body.practice.id as string;
    const created = await owner.agent
      .post(`/api/practices/${practiceId}/invites`)
      .send({ email: "gone@clinic.test", role: "readonly" });
    expect(created.status).toBe(201);

    const revoked = await owner.agent.delete(
      `/api/practices/${practiceId}/invites/${created.body.invite.id}`,
    );
    expect(revoked.status).toBe(200);

    const token = tokenFromMailer(mailer, "practice_invite");
    const accept = await request(app).post("/api/invites/accept").send({
      token,
      password: STRONG,
      username: "goneuser",
      displayName: "Gone",
    });
    expect(accept.status).toBe(400);
  });

  it("staff and readonly cannot create invites", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "rbac");
    const hash = (await storage.getUserByUsername("user_rbac"))!;
    await addMember(storage, {
      email: "staffer@clinic.test",
      username: "staffer",
      role: "staff",
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      passwordHash: hash.passwordHash,
    });
    const staff = request.agent(app);
    const login = await staff.post("/api/auth/login").send({
      login: "staffer",
      password: STRONG,
    });
    expect(login.status).toBe(200);

    const denied = await staff
      .post(`/api/practices/${owner.body.practice.id}/invites`)
      .send({ email: "x@clinic.test", role: "staff" });
    expect(denied.status).toBe(403);
  });
});

describe("TOTP MFA", () => {
  it("enroll → login requires MFA → verify succeeds", async () => {
    let current = new Date("2026-04-01T12:00:00Z");
    const { app } = testApp({ now: () => current });
    const owner = await register(app, "mfa");

    const start = await owner.agent.post("/api/auth/mfa/enroll/start");
    expect(start.status).toBe(200);
    expect(start.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(start.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(start.body.mfaEnabled).toBe(false);

    const meBefore = await owner.agent.get("/api/me");
    expect(meBefore.body.user.mfa.enabled).toBe(false);

    const confirmFail = await owner.agent.post("/api/auth/mfa/enroll/confirm").send({
      code: "000000",
    });
    expect(confirmFail.status).toBe(400);

    const code = generateTotpCode(start.body.secret, current);
    const confirm = await owner.agent.post("/api/auth/mfa/enroll/confirm").send({
      code,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.mfaEnabled).toBe(true);
    expect(confirm.body.recoveryCodes).toHaveLength(10);

    const meAfter = await owner.agent.get("/api/me");
    expect(meAfter.body.user.mfa.enabled).toBe(true);
    expect(meAfter.body.user.mfa.methods).toEqual(["totp"]);

    await owner.agent.post("/api/auth/logout");

    const pending = request.agent(app);
    const login = await pending.post("/api/auth/login").send({
      login: "mfa@clinic.test",
      password: STRONG,
    });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.challengeToken).toBeTruthy();

    const meBlocked = await pending.get("/api/me");
    expect(meBlocked.status).toBe(401);

    const totp = generateTotpCode(start.body.secret, current);
    const verified = await pending.post("/api/auth/mfa/verify").send({
      challengeToken: login.body.challengeToken,
      code: totp,
    });
    expect(verified.status).toBe(200);
    expect(verified.body.mfaRequired).toBe(false);

    const meOk = await pending.get("/api/me");
    expect(meOk.status).toBe(200);
    expect(meOk.body.user.mfa.enabled).toBe(true);
  });

  it("accepts a single-use recovery code at login", async () => {
    let current = new Date("2026-04-02T12:00:00Z");
    const { app } = testApp({ now: () => current });
    const owner = await register(app, "recov");
    const start = await owner.agent.post("/api/auth/mfa/enroll/start");
    const confirm = await owner.agent.post("/api/auth/mfa/enroll/confirm").send({
      code: generateTotpCode(start.body.secret, current),
    });
    const recovery = confirm.body.recoveryCodes[0] as string;
    await owner.agent.post("/api/auth/logout");

    const login = await request(app).post("/api/auth/login").send({
      login: "recov@clinic.test",
      password: STRONG,
    });
    const agent = request.agent(app);
    const first = await agent.post("/api/auth/mfa/verify").send({
      challengeToken: login.body.challengeToken,
      code: recovery,
    });
    expect(first.status).toBe(200);
    await agent.post("/api/auth/logout");

    const login2 = await request(app).post("/api/auth/login").send({
      login: "recov@clinic.test",
      password: STRONG,
    });
    const reuse = await request(app).post("/api/auth/mfa/verify").send({
      challengeToken: login2.body.challengeToken,
      code: recovery,
    });
    expect(reuse.status).toBe(401);
  });

  it("disables MFA with password + TOTP and regenerates the session", async () => {
    let current = new Date("2026-04-03T12:00:00Z");
    const { app } = testApp({ now: () => current });
    const owner = await register(app, "offmfa");
    const start = await owner.agent.post("/api/auth/mfa/enroll/start");
    await owner.agent.post("/api/auth/mfa/enroll/confirm").send({
      code: generateTotpCode(start.body.secret, current),
    });

    const disabled = await owner.agent.post("/api/auth/mfa/disable").send({
      password: STRONG,
      code: generateTotpCode(start.body.secret, current),
    });
    expect(disabled.status).toBe(200);

    const me = await owner.agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.mfa.enabled).toBe(false);

    const login = await request(app).post("/api/auth/login").send({
      login: "offmfa@clinic.test",
      password: STRONG,
    });
    expect(login.body.mfaRequired).toBe(false);
  });
});

describe("RBAC writes", () => {
  it("readonly cannot create, update, or delete patients", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "phi");
    const created = await owner.agent.post("/api/patients").send({ name: "Pat" });
    expect(created.status).toBe(201);
    const patientId = created.body.patient.id as string;

    const hash = (await storage.getUserByUsername("user_phi"))!;
    await addMember(storage, {
      email: "reader2@clinic.test",
      username: "reader2",
      role: "readonly",
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      passwordHash: hash.passwordHash,
    });

    const reader = request.agent(app);
    const login = await reader.post("/api/auth/login").send({
      login: "reader2",
      password: STRONG,
    });
    expect(login.status).toBe(200);

    expect((await reader.get("/api/patients")).status).toBe(200);
    expect((await reader.post("/api/patients").send({ name: "Nope" })).status).toBe(403);
    expect(
      (await reader.patch(`/api/patients/${patientId}`).send({ name: "Nope" })).status,
    ).toBe(403);
    expect((await reader.delete(`/api/patients/${patientId}`)).status).toBe(403);
  });

  it("staff can create patients but cannot invite", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "staffw");
    const hash = (await storage.getUserByUsername("user_staffw"))!;
    await addMember(storage, {
      email: "writer@clinic.test",
      username: "writer",
      role: "staff",
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
      passwordHash: hash.passwordHash,
    });
    const staff = request.agent(app);
    await staff.post("/api/auth/login").send({ login: "writer", password: STRONG });
    const created = await staff.post("/api/patients").send({ name: "Staff Patient" });
    expect(created.status).toBe(201);
    const invite = await staff
      .post(`/api/practices/${owner.body.practice.id}/invites`)
      .send({ email: "x@clinic.test", role: "staff" });
    expect(invite.status).toBe(403);
  });
});
