import { describe, expect, it } from "vitest";
import request from "supertest";
import { isAesGcmCiphertext } from "../server/crypto/aes-gcm";
import { createApp } from "../server/app";
import { pruneExpiredImportRawRows } from "../server/import/prune";
import { createMemoryStorage } from "../server/storage/memory";
import {
  buildAnalysisPrompt,
  computeAdvancedMetrics,
} from "../shared/advanced-metrics";
import { parseCsv } from "../shared/import";

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

function field(
  body: {
    sections: Array<{ fields: Array<{ key: string; [k: string]: unknown }> }>;
  },
  key: string,
) {
  for (const section of body.sections) {
    const found = section.fields.find((f) => f.key === key);
    if (found) return found;
  }
  throw new Error(`missing field ${key}`);
}

describe("advanced metrics math", () => {
  it("computes close rate, case average, and RPV from daily log + patients", () => {
    const snapshot = computeAdvancedMetrics({
      month: "2026-09",
      dailyStats: [
        { date: "2026-09-01", visits: 10, revenueCents: 100_000 },
        { date: "2026-09-02", visits: 5, revenueCents: 50_000 },
      ],
      patients: [
        {
          patientType: "new",
          converted: true,
          day1Date: "2026-09-01",
          createdAt: NOW,
        },
        {
          patientType: "new",
          converted: false,
          day1Date: "2026-09-02",
          createdAt: NOW,
        },
      ],
      inputs: [
        {
          section: "get",
          key: "consults_booked",
          valueNumeric: 4,
          valueText: null,
          source: "manual",
        },
        {
          section: "get",
          key: "patients_showed",
          valueNumeric: 3,
          valueText: null,
          source: "manual",
        },
      ],
    });
    const byKey = Object.fromEntries(
      snapshot.sections.flatMap((s) => s.fields.map((f) => [f.key, f])),
    );
    expect(byKey.close_rate.available).toBe(true);
    expect(byKey.close_rate.value).toBe(50);
    expect(byKey.case_average.available).toBe(true);
    expect(byKey.case_average.value).toBe(750);
    expect(byKey.rpv.available).toBe(true);
    expect(byKey.rpv.value).toBe(100);
    expect(byKey.show_rate.available).toBe(true);
    expect(byKey.show_rate.value).toBe(75);
    expect(byKey.pva.available).toBe(true);
    expect(byKey.pva.value).toBe(7.5);
  });

  it("marks automatic fields unavailable when there is no daily log", () => {
    const snapshot = computeAdvancedMetrics({
      month: "2026-09",
      dailyStats: [],
      patients: [],
      inputs: [],
    });
    const byKey = Object.fromEntries(
      snapshot.sections.flatMap((s) => s.fields.map((f) => [f.key, f])),
    );
    expect(byKey.rpv.available).toBe(false);
    expect(byKey.case_average.available).toBe(false);
    expect(byKey.close_rate.available).toBe(false);
    expect(byKey.rpv.reason).toMatch(/Daily Log/i);
    const prompt = buildAnalysisPrompt(snapshot);
    expect(prompt).toContain("aggregates only");
    expect(prompt).not.toMatch(/Jane|Doe|@/);
  });
});

describe("csv parser", () => {
  it("handles quoted commas", () => {
    const sheet = parseCsv('Date,Notes\n2026-09-01,"hello, world"\n');
    expect(sheet.headers).toEqual(["Date", "Notes"]);
    expect(sheet.rows[0]).toEqual(["2026-09-01", "hello, world"]);
  });
});

describe("Advanced Metrics APIs", () => {
  it("exposes automatic metrics once a daily log exists", async () => {
    const { app } = testApp();
    const a = await register(app, "metauto");

    const empty = await a.agent.get("/api/advanced-metrics?month=2026-09");
    expect(empty.status).toBe(200);
    expect(empty.body.openai).toBe(false);
    expect(field(empty.body, "rpv").available).toBe(false);
    expect(field(empty.body, "case_average").available).toBe(false);
    expect(empty.body.emptyState).toBe("no_entries");

    const logged = await a.agent.post("/api/daily-log").send({
      date: "2026-09-01",
      visits: 8,
      revenue: 800,
    });
    expect(logged.status).toBe(201);

    const patient = await a.agent.post("/api/patients").send({
      name: "SecretName Patient",
      patientType: "new",
      day1Date: "2026-09-01",
      converted: true,
    });
    expect(patient.status).toBe(201);

    const ready = await a.agent.get("/api/advanced-metrics?month=2026-09");
    expect(ready.status).toBe(200);
    expect(field(ready.body, "rpv").available).toBe(true);
    expect(field(ready.body, "rpv").value).toBe(100);
    expect(field(ready.body, "close_rate").available).toBe(true);
    expect(field(ready.body, "close_rate").value).toBe(100);
    expect(field(ready.body, "case_average").available).toBe(true);
    expect(field(ready.body, "new_patients").value).toBe(1);

    const saved = await a.agent.put("/api/advanced-metrics").send({
      month: "2026-09",
      fields: [
        { key: "monthly_leads", value: 12 },
        { key: "consults_booked", value: 10 },
        { key: "patients_showed", value: 8 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(field(saved.body, "monthly_leads").value).toBe(12);
    expect(field(saved.body, "show_rate").value).toBe(80);

    const prompt = await a.agent.get(
      "/api/advanced-metrics/prompt?month=2026-09",
    );
    expect(prompt.status).toBe(200);
    expect(prompt.body.openai).toBe(false);
    expect(prompt.body.aggregatesOnly).toBe(true);
    expect(prompt.body.prompt).not.toContain("SecretName");
    expect(prompt.body.prompt).toContain("Monthly Leads");
  });

  it("readonly cannot PUT metrics; staff can", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "metro");
    const ownerUser = (await storage.getUserByUsername("user_metro"))!;
    const readerUser = await storage.createUser({
      email: "readermet@clinic.test",
      username: "readermet",
      passwordHash: ownerUser.passwordHash,
      displayName: "Reader",
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
      email: "staffmet@clinic.test",
      username: "staffmet",
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
          .send({ login: "readermet", password: STRONG })
      ).status,
    ).toBe(200);
    expect((await reader.get("/api/advanced-metrics?month=2026-09")).status).toBe(
      200,
    );
    expect(
      (
        await reader.put("/api/advanced-metrics").send({
          month: "2026-09",
          fields: [{ key: "monthly_leads", value: 1 }],
        })
      ).status,
    ).toBe(403);

    const staff = request.agent(app);
    expect(
      (
        await staff
          .post("/api/auth/login")
          .send({ login: "staffmet", password: STRONG })
      ).status,
    ).toBe(200);
    const written = await staff.put("/api/advanced-metrics").send({
      month: "2026-09",
      fields: [{ key: "monthly_leads", value: 7 }],
    });
    expect(written.status).toBe(200);
    expect(field(written.body, "monthly_leads").value).toBe(7);
  });

  it("does not leak Practice B metrics over HTTP", async () => {
    const { app } = testApp();
    const a = await register(app, "metA");
    const b = await register(app, "metB");
    await b.agent.put("/api/advanced-metrics").send({
      month: "2026-09",
      fields: [{ key: "monthly_leads", value: 42 }],
    });
    const listed = await a.agent.get("/api/advanced-metrics?month=2026-09");
    expect(listed.status).toBe(200);
    expect(field(listed.body, "monthly_leads").value).toBeNull();
    const steal = await a.agent
      .get("/api/advanced-metrics?month=2026-09")
      .set("x-practice-id", b.body.practice.id);
    expect(steal.status).toBe(403);
  });
});

describe("CSV / Excel import APIs", () => {
  it("preview does not commit; commit creates daily_stats rows", async () => {
    const { app, storage } = testApp({ phiEncryptionKey: PHI_KEY });
    const a = await register(app, "impcommit");
    const csv = [
      "Date,Visits,Revenue,Name",
      "2026-09-01,4,400,Jane Doe",
      "2026-09-02,0,50,",
    ].join("\n");

    const uploaded = await a.agent.post("/api/import/upload").send({
      fileName: "sept.csv",
      csv,
    });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.openai).toBe(false);
    expect(uploaded.body.chirotouch).toBe(false);
    const batchId = uploaded.body.batch.id as string;
    expect(JSON.stringify(uploaded.body.sampleRows)).not.toContain("Jane Doe");

    const raw = storage.importRows[0];
    expect(isAesGcmCiphertext(raw.rawData)).toBe(true);
    expect(raw.rawData).not.toContain("Jane Doe");

    const mapped = await a.agent.post(`/api/import/batches/${batchId}/map`).send({
      mappings: [
        { sourceColumn: "Date", targetField: "date" },
        { sourceColumn: "Visits", targetField: "visits" },
        { sourceColumn: "Revenue", targetField: "revenue" },
        { sourceColumn: "Name", targetField: "name" },
      ],
    });
    expect(mapped.status).toBe(200);

    const preview = await a.agent
      .post(`/api/import/batches/${batchId}/preview`)
      .send({});
    expect(preview.status).toBe(200);
    expect(preview.body.committed).toBe(false);
    expect(preview.body.counts.validCount).toBe(2);
    expect(preview.body.counts.dailyLogCreates).toBe(2);
    expect(preview.body.counts.patientCreates).toBe(1);
    expect(preview.body.counts.anomalyWarnings).toBe(1);
    const sampleText = JSON.stringify(preview.body.sample);
    expect(sampleText).not.toContain("Jane Doe");
    expect(sampleText).toContain("J***");

    const before = await a.agent.get("/api/daily-log?from=2026-09-01&to=2026-09-02");
    expect(before.body.entries).toEqual([]);

    const committed = await a.agent
      .post(`/api/import/batches/${batchId}/commit`)
      .send({});
    expect(committed.status).toBe(200);
    expect(committed.body.counts.dailyLogCreates).toBe(2);
    expect(committed.body.counts.patientCreates).toBe(1);
    expect(committed.body.warnings.some((w: { code: string }) => w.code === "revenue_without_visits")).toBe(
      true,
    );

    const after = await a.agent.get("/api/daily-log?from=2026-09-01&to=2026-09-02");
    expect(after.body.entries).toHaveLength(2);
    expect(after.body.entries.map((e: { date: string }) => e.date).sort()).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
    const patients = await a.agent.get("/api/patients");
    expect(patients.body.patients.map((p: { name: string }) => p.name)).toEqual([
      "Jane Doe",
    ]);
  });

  it("readonly cannot commit import", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "impro");
    const uploaded = await owner.agent.post("/api/import/upload").send({
      fileName: "days.csv",
      csv: "Date,Visits,Revenue\n2026-09-03,2,200\n",
    });
    expect(uploaded.status).toBe(201);
    const batchId = uploaded.body.batch.id as string;
    await owner.agent.post(`/api/import/batches/${batchId}/map`).send({
      mappings: [
        { sourceColumn: "Date", targetField: "date" },
        { sourceColumn: "Visits", targetField: "visits" },
        { sourceColumn: "Revenue", targetField: "revenue" },
      ],
    });

    const ownerUser = (await storage.getUserByUsername("user_impro"))!;
    const readerUser = await storage.createUser({
      email: "readerimp@clinic.test",
      username: "readerimp",
      passwordHash: ownerUser.passwordHash,
      displayName: "Reader",
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
      email: "staffimp@clinic.test",
      username: "staffimp",
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
          .send({ login: "readerimp", password: STRONG })
      ).status,
    ).toBe(200);
    expect((await reader.get("/api/import/batches")).status).toBe(403);
    expect(
      (await reader.post(`/api/import/batches/${batchId}/commit`).send({})).status,
    ).toBe(403);

    const staff = request.agent(app);
    expect(
      (
        await staff
          .post("/api/auth/login")
          .send({ login: "staffimp", password: STRONG })
      ).status,
    ).toBe(200);
    expect(
      (await staff.post(`/api/import/batches/${batchId}/commit`).send({})).status,
    ).toBe(403);
  });

  it("does not leak Practice B import batches", async () => {
    const { app } = testApp();
    const a = await register(app, "impA");
    const b = await register(app, "impB");
    const created = await b.agent.post("/api/import/upload").send({
      fileName: "secret.csv",
      csv: "Date,Visits\n2026-09-01,9\n",
    });
    expect(created.status).toBe(201);
    const batchId = created.body.batch.id as string;

    const listA = await a.agent.get("/api/import/batches");
    expect(listA.status).toBe(200);
    expect(listA.body.batches).toEqual([]);

    const steal = await a.agent.get(`/api/import/batches/${batchId}`);
    expect(steal.status).toBe(404);

    const stealHeader = await a.agent
      .get("/api/import/batches")
      .set("x-practice-id", b.body.practice.id);
    expect(stealHeader.status).toBe(403);
  });

  it("prune stub clears expired raw rows without dropping batch history", async () => {
    const { storage } = testApp({ phiEncryptionKey: PHI_KEY });
    const org = await storage.createOrganization({ name: "Org" });
    const practice = await storage.createPractice({
      orgId: org.id,
      name: "Clinic",
    });
    const scope = { orgId: org.id, practiceId: practice.id };
    const batch = await storage.createImportBatch(scope, {
      fileName: "old.csv",
      fileType: "csv",
      rawExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    await storage.createImportRow(scope, {
      batchId: batch.id,
      rowNumber: 1,
      rawData: JSON.stringify(["Jane Doe", "555-0100"]),
    });
    const result = await pruneExpiredImportRawRows(
      storage,
      new Date("2026-09-16T00:00:00.000Z"),
    );
    expect(result.cleared).toBe(1);
    const listed = await storage.listImportBatches(scope);
    expect(listed).toHaveLength(1);
    const rows = await storage.listImportRows(scope, batch.id);
    expect(rows[0].rawData).toBe("");
  });
});
