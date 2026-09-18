import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { redactRecord, REDACTED } from "../server/log/redact";
import {
  awsCredentialsPresent,
  AwsSecretsManagerProvider,
  createSecretsProvider,
  NoopSecretsProvider,
  SECRET_MANAGER_NAMES,
} from "../server/secrets";
import { hashPassword } from "../server/auth/password";
import { createMemoryStorage } from "../server/storage/memory";
import type { MemoryStorage } from "../server/storage/memory";

const STRONG = "CorrectHorse-Battery9!";
const SESSION_SECRET = "test-session-secret-not-for-production";
const MFA_KEY = "test-mfa-encryption-key-min-32-chars!!";
const PHI_KEY = "test-phi-encryption-key-min-32-chars!!";

function testApp(opts?: { storage?: MemoryStorage; forceHttps?: boolean; trustProxy?: boolean }) {
  const storage = opts?.storage ?? createMemoryStorage({ phiEncryptionKey: PHI_KEY });
  const app = createApp({
    storage,
    mfaEncryptionKey: MFA_KEY,
    forceHttps: opts?.forceHttps,
    session: {
      secret: SESSION_SECRET,
      secure: false,
      sameSite: "lax",
      trustProxy: opts?.trustProxy ?? false,
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

describe("security headers", () => {
  it("sets Helmet defaults and hides X-Powered-By", async () => {
    const { app } = testApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("redirects HTTP to HTTPS only when FORCE_HTTPS is enabled", async () => {
    const { app } = testApp({ forceHttps: true, trustProxy: true });
    const redirected = await request(app).get("/api/health");
    expect(redirected.status).toBe(301);
    expect(redirected.headers.location).toMatch(/^https:\/\//);

    const viaProxy = await request(app)
      .get("/api/health")
      .set("x-forwarded-proto", "https");
    expect(viaProxy.status).toBe(200);
  });
});

describe("production config fail-fast", () => {
  const prodBase = {
    NODE_ENV: "production",
    SESSION_SECRET: "a".repeat(32),
    MFA_ENCRYPTION_KEY: "b".repeat(32),
    PHI_ENCRYPTION_KEY: "c".repeat(32),
    DATABASE_URL: "postgres://app:strong@db.internal:5432/chirokpi",
  };

  it("starts when production secrets are present and distinct", () => {
    const cfg = loadConfig(prodBase);
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.cookieSecure).toBe(true);
    expect(cfg.phiEncryptionKey).toHaveLength(32);
  });

  it("rejects missing DATABASE_URL in production", () => {
    expect(() =>
      loadConfig({ ...prodBase, DATABASE_URL: "" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects placeholder SESSION_SECRET in production", () => {
    expect(() =>
      loadConfig({
        ...prodBase,
        SESSION_SECRET: "replace-with-a-long-random-string-min-32",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("rejects reused MFA and PHI keys in production", () => {
    expect(() =>
      loadConfig({
        ...prodBase,
        PHI_ENCRYPTION_KEY: prodBase.MFA_ENCRYPTION_KEY,
      }),
    ).toThrow(/distinct/);
  });

  it("rejects the local docker DATABASE_URL in production", () => {
    expect(() =>
      loadConfig({
        ...prodBase,
        DATABASE_URL: "postgres://chirokpi:chirokpi_local@localhost:5432/chirokpi",
      }),
    ).toThrow(/local docker/);
  });
});

describe("redacting logger helper", () => {
  it("redacts secrets and contact fields, keeps IDs", () => {
    const out = redactRecord({
      userId: "user-1",
      orgId: "org-1",
      password: "CorrectHorse-Battery9!",
      sessionSecret: "abc",
      email: "alice@clinic.test",
      token: "raw-token",
      count: 3,
    });
    expect(out).toEqual({
      userId: "user-1",
      orgId: "org-1",
      password: REDACTED,
      sessionSecret: REDACTED,
      email: REDACTED,
      token: REDACTED,
      count: 3,
    });
  });
});

describe("secrets providers", () => {
  it("maps env var names to Secrets Manager ids without calling AWS", async () => {
    expect(SECRET_MANAGER_NAMES.PHI_ENCRYPTION_KEY).toMatch(/PHI_ENCRYPTION_KEY/);
    expect(awsCredentialsPresent({})).toBe(false);
    expect(await new NoopSecretsProvider().get("SESSION_SECRET")).toBeUndefined();
    const envProvider = createSecretsProvider();
    expect(await envProvider.get("NOT_A_REAL_SECRET")).toBeUndefined();
  });

  it("AWS adapter no-ops without a client even if env looks like AWS", async () => {
    const provider = new AwsSecretsManagerProvider({
      env: { AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "AKIATEST" },
    });
    expect(await provider.get("SESSION_SECRET")).toBeUndefined();
  });

  it("AWS adapter fetches only when a client is injected", async () => {
    const provider = new AwsSecretsManagerProvider({
      env: { AWS_REGION: "us-east-1", AWS_WEB_IDENTITY_TOKEN_FILE: "/tmp/token" },
      client: {
        async send({ secretId }) {
          return { SecretString: `from-sm:${secretId}` };
        },
      },
    });
    const value = await provider.get("SESSION_SECRET");
    expect(value).toBe(`from-sm:${SECRET_MANAGER_NAMES.SESSION_SECRET}`);
  });
});

describe("audit expansion", () => {
  it("owner can list tenant-scoped audit logs; readonly cannot", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "audown");
    await owner.agent.post("/api/patients").send({
      name: "Pat",
      email: "pat@clinic.test",
    });

    const ownerList = await owner.agent.get("/api/audit-logs?limit=20&offset=0");
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.page.total).toBeGreaterThan(0);
    expect(ownerList.body.logs[0]).toHaveProperty("action");
    expect(ownerList.body.logs[0]).toHaveProperty("actorId");
    expect(ownerList.body.logs[0]).not.toHaveProperty("ipAddress");
    const serialized = JSON.stringify(ownerList.body);
    expect(serialized).not.toContain("pat@clinic.test");
    expect(serialized).not.toContain(STRONG);

    const hash = await hashPassword(STRONG);
    const reader = await storage.createUser({
      email: "reader-audit@clinic.test",
      username: "reader_audit",
      passwordHash: hash,
      displayName: "Reader",
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
    const readerAgent = request.agent(app);
    const login = await readerAgent.post("/api/auth/login").send({
      login: "reader_audit",
      password: STRONG,
    });
    expect(login.status).toBe(200);
    const denied = await readerAgent.get("/api/audit-logs");
    expect(denied.status).toBe(403);
  });

  it("failed login is audited without the password", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "failin");
    const failed = await request(app).post("/api/auth/login").send({
      login: "failin@clinic.test",
      password: "WrongPassword-Battery9!",
    });
    expect(failed.status).toBe(401);

    const logs = await storage.listAuditLogs({
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
    });
    const failRow = logs.find((row) => row.action === "login_failed");
    expect(failRow).toBeTruthy();
    expect(failRow?.resourceType).toBe("session");
    expect(JSON.stringify(failRow)).not.toMatch(/WrongPassword/);
    expect(JSON.stringify(failRow)).not.toMatch(/CorrectHorse/);
    expect(failRow?.metadata).toEqual({ reason: "invalid_credentials" });
  });

  it("decrypts patient contact on API read after storing ciphertext", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "encapi");
    const created = await owner.agent.post("/api/patients").send({
      name: "Casey",
      email: "casey@clinic.test",
      phone: "555-0199",
      dateOfBirth: "1975-06-01",
    });
    expect(created.status).toBe(201);
    expect(created.body.patient.email).toBe("casey@clinic.test");
    expect(storage.patients[0].email).toMatch(/^v1:/);
    expect(storage.patients[0].email).not.toContain("casey@clinic.test");

    const listed = await owner.agent.get("/api/patients");
    expect(listed.body.patients[0].email).toBe("casey@clinic.test");
    expect(listed.body.patients[0].dateOfBirth).toBe("1975-06-01");
  });
});
