import { describe, expect, it } from "vitest";
import request from "supertest";
import { isAesGcmCiphertext } from "../server/crypto/aes-gcm";
import { createApp } from "../server/app";
import { createMemoryStorage } from "../server/storage/memory";
import {
  computePaymentQuotes,
  computeSubtotalCents,
  DEFAULT_PAYMENT_SETTINGS,
  percentOfCents,
} from "../shared/care-plans";

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

async function acknowledge(agent: ReturnType<typeof request.agent>) {
  const res = await agent.post("/api/care-plans/compliance/acknowledge");
  expect(res.status).toBe(200);
  expect(res.body.acknowledged).toBe(true);
  return res;
}

async function addTreatments(agent: ReturnType<typeof request.agent>) {
  const adj = await agent.post("/api/treatments").send({
    name: "Cervical adjustment",
    category: "Adjustment",
    price: 65,
  });
  expect(adj.status).toBe(201);
  const therapy = await agent.post("/api/treatments").send({
    name: "Interferential",
    category: "Therapy",
    priceCents: 4000,
  });
  expect(therapy.status).toBe(201);
  return {
    adjId: adj.body.treatment.id as string,
    therapyId: therapy.body.treatment.id as string,
  };
}

describe("care plan math", () => {
  it("computes subtotal from catalog priceCents × quantity", () => {
    const catalog = [
      { id: "a", name: "Adj", category: "Adjustment", priceCents: 6500, active: true },
      { id: "t", name: "Therapy", category: "Therapy", priceCents: 4000, active: true },
    ];
    const result = computeSubtotalCents(
      [
        { treatmentId: "a", quantity: 12 },
        { treatmentId: "t", quantity: 3 },
      ],
      catalog,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subtotalCents).toBe(12 * 6500 + 3 * 4000);

    const quotes = computePaymentQuotes(90000, {
      ...DEFAULT_PAYMENT_SETTINGS,
      payInFull: { enabled: true, discountPercent: 10 },
      monthlyPlan: { enabled: true, discountPercent: 5, months: 6 },
      downPaymentPlan: {
        enabled: true,
        discountPercent: 7,
        months: 4,
        downPaymentPercent: 30,
      },
    });
    expect(quotes.payInFull?.totalCents).toBe(90000 - percentOfCents(90000, 10));
    expect(quotes.monthlyPlan?.months).toBe(6);
    expect(quotes.downPaymentPlan?.downPaymentPercent).toBe(30);
  });
});

describe("Care plan compliance gate", () => {
  it("cannot create a plan without acknowledging the notice", async () => {
    const { app } = testApp();
    const a = await register(app, "cpnoack");
    const { adjId } = await addTreatments(a.agent);

    const compliance = await a.agent.get("/api/care-plans/compliance");
    expect(compliance.status).toBe(200);
    expect(compliance.body.acknowledged).toBe(false);
    expect(compliance.body.notice).toMatch(/vary by state/i);
    expect(compliance.body.code).toBeUndefined();

    const created = await a.agent.post("/api/care-plans").send({
      firstName: "Pat",
      lastName: "Ient",
      treatmentSelections: [{ treatmentId: adjId, quantity: 2 }],
    });
    expect(created.status).toBe(403);
    expect(created.body.code).toBe("compliance_required");
    expect(created.body.error).toBe("compliance_required");

    const pdfBlocked = await a.agent.get("/api/care-plans/x/export.pdf");
    expect(pdfBlocked.status).toBe(403);
    expect(pdfBlocked.body.code).toBe("compliance_required");

    const listed = await a.agent.get("/api/care-plans");
    expect(listed.status).toBe(200);
    expect(listed.body.carePlans).toEqual([]);
  });

  it("unlocks create after acknowledge and audits without names", async () => {
    const { app } = testApp();
    const a = await register(app, "cpack");
    const { adjId } = await addTreatments(a.agent);
    await acknowledge(a.agent);

    const created = await a.agent.post("/api/care-plans").send({
      firstName: "Secret",
      lastName: "Patient",
      notes: "do not audit this note",
      treatmentSelections: [{ treatmentId: adjId, quantity: 2 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.carePlan.firstName).toBe("Secret");
    expect(created.body.carePlan.subtotalCents).toBe(13000);

    const logs = await a.agent.get("/api/audit-logs");
    const ack = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "care_plan_compliance" && row.action === "acknowledge",
    );
    expect(ack).toBeTruthy();
    const create = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "care_plan" && row.action === "create",
    );
    expect(create).toBeTruthy();
    expect(JSON.stringify(logs.body)).not.toContain("Secret");
    expect(JSON.stringify(logs.body)).not.toContain("Patient");
    expect(JSON.stringify(logs.body)).not.toContain("do not audit");
  });
});

describe("Care plan generator APIs", () => {
  it("computes subtotal from treatments.priceCents and returns payment quotes", async () => {
    const { app } = testApp();
    const a = await register(app, "cpmath");
    const { adjId, therapyId } = await addTreatments(a.agent);
    await acknowledge(a.agent);

    const created = await a.agent.post("/api/care-plans").send({
      firstName: "Casey",
      lastName: "Lee",
      treatmentSelections: {
        [adjId]: 12,
        [therapyId]: 3,
      },
      paymentSettings: {
        payInFull: { enabled: true, discount: 10 },
        monthlyPlan: { enabled: true, discount: 5, months: 6 },
        downPaymentPlan: {
          enabled: true,
          discount: 7,
          months: 4,
          downPaymentPercentage: 30,
        },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.carePlan.subtotalCents).toBe(90000);
    expect(created.body.carePlan.subtotal).toBe(900);
    expect(created.body.carePlan.subtotalDisplay).toBe("$900.00");
    expect(created.body.carePlan.paymentQuotes.payInFull.totalCents).toBe(81000);
    expect(created.body.carePlan.lineItems).toHaveLength(2);

    const listed = await a.agent.get("/api/care-plans");
    expect(listed.body.emptyState).toBe("has_data");
    expect(listed.body.carePlans[0].id).toBe(created.body.carePlan.id);
  });

  it("Practice A cannot list, fetch, mutate, or export Practice B care plans", async () => {
    const { app } = testApp();
    const a = await register(app, "cpa");
    const b = await register(app, "cpb");
    const { adjId } = await addTreatments(b.agent);
    await acknowledge(b.agent);

    const createdB = await b.agent.post("/api/care-plans").send({
      firstName: "Bob",
      lastName: "FromB",
      treatmentSelections: [{ treatmentId: adjId, quantity: 1 }],
    });
    expect(createdB.status).toBe(201);
    const bid = createdB.body.carePlan.id as string;

    const listA = await a.agent.get("/api/care-plans");
    expect(listA.status).toBe(200);
    expect(listA.body.carePlans).toEqual([]);
    expect(JSON.stringify(listA.body)).not.toContain("FromB");
    expect(JSON.stringify(listA.body)).not.toContain("Bob");

    expect((await a.agent.get(`/api/care-plans/${bid}`)).status).toBe(404);
    expect(
      (await a.agent.patch(`/api/care-plans/${bid}`).send({ notes: "x" })).status,
    ).toBe(403);
    await acknowledge(a.agent);
    expect(
      (await a.agent.patch(`/api/care-plans/${bid}`).send({ notes: "x" })).status,
    ).toBe(404);
    expect((await a.agent.delete(`/api/care-plans/${bid}`)).status).toBe(404);
    expect((await a.agent.get(`/api/care-plans/${bid}/export.pdf`)).status).toBe(
      404,
    );

    const header = await a.agent
      .get("/api/care-plans")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("PDF export returns application/pdf after ack and is audited without names", async () => {
    const { app } = testApp();
    const a = await register(app, "cppdf");
    const { adjId } = await addTreatments(a.agent);
    await acknowledge(a.agent);
    const created = await a.agent.post("/api/care-plans").send({
      firstName: "Hidden",
      lastName: "Name",
      treatmentSelections: [{ treatmentId: adjId, quantity: 1 }],
      status: "final",
    });
    expect(created.status).toBe(201);
    const id = created.body.carePlan.id as string;

    const pdf = await a.agent
      .get(`/api/care-plans/${id}/export.pdf`)
      .buffer(true)
      .parse((res, fn) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => fn(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect((pdf.body as Buffer).subarray(0, 4).toString("utf8")).toBe("%PDF");

    const logs = await a.agent.get("/api/audit-logs");
    const exported = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "care_plan" && row.action === "export",
    );
    expect(exported).toBeTruthy();
    expect(exported.metadata.format).toBe("pdf");
    expect(JSON.stringify(exported)).not.toContain("Hidden");
    expect(JSON.stringify(exported)).not.toContain("Name");
  });

  it("readonly can GET after ack but cannot create; staff cannot delete", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "cprbac");
    const { adjId } = await addTreatments(owner.agent);
    await acknowledge(owner.agent);
    const created = await owner.agent.post("/api/care-plans").send({
      firstName: "Keep",
      lastName: "Plan",
      treatmentSelections: [{ treatmentId: adjId, quantity: 1 }],
    });
    expect(created.status).toBe(201);
    const id = created.body.carePlan.id as string;

    const hash = (await storage.getUserByUsername("user_cprbac"))!;
    const readerUser = await storage.createUser({
      email: "readercp@clinic.test",
      username: "readercp",
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
    expect(
      (
        await reader
          .post("/api/auth/login")
          .send({ login: "readercp", password: STRONG })
      ).status,
    ).toBe(200);
    await acknowledge(reader);
    expect((await reader.get("/api/care-plans")).status).toBe(200);
    expect(
      (
        await reader.post("/api/care-plans").send({
          firstName: "No",
          lastName: "Write",
          treatmentSelections: [{ treatmentId: adjId, quantity: 1 }],
        })
      ).status,
    ).toBe(403);

    const staffUser = await storage.createUser({
      email: "staffcp@clinic.test",
      username: "staffcp",
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
    expect(
      (await staff.post("/api/auth/login").send({ login: "staffcp", password: STRONG }))
        .status,
    ).toBe(200);
    await acknowledge(staff);
    const written = await staff.post("/api/care-plans").send({
      firstName: "Staff",
      lastName: "Write",
      treatmentSelections: [{ treatmentId: adjId, quantity: 1 }],
    });
    expect(written.status).toBe(201);
    expect((await staff.delete(`/api/care-plans/${written.body.carePlan.id}`)).status).toBe(
      403,
    );
    expect((await owner.agent.delete(`/api/care-plans/${id}`)).status).toBe(200);
  });

  it("encrypts first/last name and notes at rest", async () => {
    const { app, storage } = testApp({ phiEncryptionKey: PHI_KEY });
    const a = await register(app, "cpenc");
    const { adjId } = await addTreatments(a.agent);
    await acknowledge(a.agent);
    const created = await a.agent.post("/api/care-plans").send({
      firstName: "Alice",
      lastName: "Cipher",
      notes: "lumbar plan",
      treatmentSelections: [{ treatmentId: adjId, quantity: 1 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.carePlan.firstName).toBe("Alice");

    const raw = storage.carePlans[0];
    expect(isAesGcmCiphertext(raw.firstName)).toBe(true);
    expect(isAesGcmCiphertext(raw.lastName)).toBe(true);
    expect(isAesGcmCiphertext(raw.notes ?? "")).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("Alice");
    expect(JSON.stringify(raw)).not.toContain("Cipher");
    expect(JSON.stringify(raw)).not.toContain("lumbar plan");
  });

  it("saves and lists templates after ack", async () => {
    const { app } = testApp();
    const a = await register(app, "cptpl");
    const { adjId } = await addTreatments(a.agent);
    expect((await a.agent.post("/api/care-plan-templates").send({
      name: "Blocked",
      treatmentSelections: [{ treatmentId: adjId, quantity: 4 }],
    })).status).toBe(403);

    await acknowledge(a.agent);
    const created = await a.agent.post("/api/care-plan-templates").send({
      name: "New patient 12-visit",
      treatmentSelections: [{ treatmentId: adjId, quantity: 12 }],
      paymentSettings: { payInFull: { enabled: true, discountPercent: 15 } },
    });
    expect(created.status).toBe(201);
    expect(created.body.template.name).toBe("New patient 12-visit");
    expect(created.body.template.defaultSelections.treatmentSelections[0].quantity).toBe(
      12,
    );

    const listed = await a.agent.get("/api/care-plan-templates");
    expect(listed.body.emptyState).toBe("has_data");
    expect(listed.body.templates).toHaveLength(1);
  });
});
