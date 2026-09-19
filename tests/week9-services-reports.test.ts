import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { createMemoryStorage } from "../server/storage/memory";

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

describe("Treatments catalog APIs", () => {
  it("creates, lists grouped, updates, and deletes a tenant-scoped service", async () => {
    const { app } = testApp();
    const a = await register(app, "svccreate");

    const empty = await a.agent.get("/api/treatments");
    expect(empty.status).toBe(200);
    expect(empty.body.emptyState).toBe("no_treatments");
    expect(empty.body.treatments).toEqual([]);
    expect(empty.body.carePlanGenerator.available).toBe(false);

    const created = await a.agent.post("/api/treatments").send({
      name: "Cervical adjustment",
      category: "adjustment",
      price: 65,
      description: "Upper cervical",
    });
    expect(created.status).toBe(201);
    expect(created.body.treatment.name).toBe("Cervical adjustment");
    expect(created.body.treatment.category).toBe("Adjustment");
    expect(created.body.treatment.priceCents).toBe(6500);
    expect(created.body.treatment.price).toBe(65);
    expect(created.body.treatment.priceDisplay).toBe("$65.00");
    expect(created.body.treatment.active).toBe(true);

    await a.agent.post("/api/treatments").send({
      name: "Interferential",
      category: "Therapy",
      priceCents: 4000,
      sortOrder: 2,
    });

    const listed = await a.agent.get("/api/treatments");
    expect(listed.status).toBe(200);
    expect(listed.body.emptyState).toBe("has_data");
    expect(listed.body.grouped.map((g: { category: string }) => g.category)).toEqual([
      "Adjustment",
      "Therapy",
    ]);

    const patched = await a.agent
      .patch(`/api/treatments/${created.body.treatment.id}`)
      .send({ price: 70, active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.treatment.priceCents).toBe(7000);
    expect(patched.body.treatment.active).toBe(false);

    const activeOnly = await a.agent.get("/api/treatments?active=true");
    expect(activeOnly.body.emptyState).toBe("has_data");
    expect(activeOnly.body.treatments.map((t: { name: string }) => t.name)).toEqual([
      "Interferential",
    ]);

    const deleted = await a.agent.delete(
      `/api/treatments/${created.body.treatment.id}`,
    );
    expect(deleted.status).toBe(200);
    const missing = await a.agent.get(
      `/api/treatments/${created.body.treatment.id}`,
    );
    expect(missing.status).toBe(404);
  });

  it("Practice A cannot list, fetch, or mutate Practice B treatments", async () => {
    const { app } = testApp();
    const a = await register(app, "svca");
    const b = await register(app, "svcb");

    const createdB = await b.agent.post("/api/treatments").send({
      name: "B only massage",
      category: "Massage",
      price: 80,
    });
    expect(createdB.status).toBe(201);
    const bid = createdB.body.treatment.id as string;

    const listA = await a.agent.get("/api/treatments");
    expect(listA.status).toBe(200);
    expect(listA.body.treatments).toEqual([]);
    expect(JSON.stringify(listA.body)).not.toContain("B only massage");

    expect((await a.agent.get(`/api/treatments/${bid}`)).status).toBe(404);
    expect(
      (await a.agent.patch(`/api/treatments/${bid}`).send({ price: 1 })).status,
    ).toBe(404);
    expect((await a.agent.delete(`/api/treatments/${bid}`)).status).toBe(404);

    const header = await a.agent
      .get("/api/treatments")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("readonly cannot create treatments; staff can write but not delete", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "svcro");
    const created = await owner.agent.post("/api/treatments").send({
      name: "Keep",
      category: "Exam",
      price: 40,
    });
    expect(created.status).toBe(201);
    const id = created.body.treatment.id as string;

    const hash = (await storage.getUserByUsername("user_svcro"))!;
    const readerUser = await storage.createUser({
      email: "readersvc@clinic.test",
      username: "readersvc",
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
    const staffUser = await storage.createUser({
      email: "staffsvc@clinic.test",
      username: "staffsvc",
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

    const reader = request.agent(app);
    expect(
      (await reader.post("/api/auth/login").send({ login: "readersvc", password: STRONG }))
        .status,
    ).toBe(200);
    expect((await reader.get("/api/treatments")).status).toBe(200);
    expect((await reader.get(`/api/treatments/${id}`)).status).toBe(200);
    expect(
      (await reader.post("/api/treatments").send({ name: "Nope", category: "Other", price: 1 }))
        .status,
    ).toBe(403);
    expect(
      (await reader.patch(`/api/treatments/${id}`).send({ price: 99 })).status,
    ).toBe(403);
    expect((await reader.delete(`/api/treatments/${id}`)).status).toBe(403);

    const staff = request.agent(app);
    expect(
      (await staff.post("/api/auth/login").send({ login: "staffsvc", password: STRONG }))
        .status,
    ).toBe(200);
    const written = await staff.post("/api/treatments").send({
      name: "Staff therapy",
      category: "Therapy",
      price: 25,
    });
    expect(written.status).toBe(201);
    expect((await staff.delete(`/api/treatments/${written.body.treatment.id}`)).status).toBe(
      403,
    );
    expect((await owner.agent.delete(`/api/treatments/${id}`)).status).toBe(200);
  });

  it("rejects negative prices and mismatched price fields; audits without description text", async () => {
    const { app } = testApp();
    const a = await register(app, "svcval");

    const neg = await a.agent.post("/api/treatments").send({
      name: "Bad",
      category: "Other",
      price: -1,
    });
    expect(neg.status).toBe(400);

    const mismatch = await a.agent.post("/api/treatments").send({
      name: "Bad",
      category: "Other",
      price: 10,
      priceCents: 1,
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe("price_mismatch");

    const created = await a.agent.post("/api/treatments").send({
      name: "Lumbar",
      category: "Adjustment",
      price: 55,
      description: "secret clinical aside should not be audited",
    });
    expect(created.status).toBe(201);
    const logs = await a.agent.get("/api/audit-logs");
    const create = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "treatment" && row.action === "create",
    );
    expect(create).toBeTruthy();
    expect(JSON.stringify(create)).not.toContain("secret clinical");
  });
});

describe("Reports APIs", () => {
  it("preview reuses dashboard KPI math, goals, referrals, and daily trend", async () => {
    const { app } = testApp();
    const a = await register(app, "rptmath");

    await a.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 10,
      revenue: 250,
    });
    await a.agent.post("/api/daily-log").send({
      date: "2026-09-12",
      visits: 5,
      revenue: 100,
    });
    await a.agent.post("/api/patients").send({
      name: "Casey",
      referralSource: "Google",
      day1Date: "2026-09-15",
      converted: true,
    });
    await a.agent.post("/api/patients").send({
      name: "Drew",
      referralSource: "Google",
      day1Date: "2026-09-16",
    });
    await a.agent.post("/api/goals").send({
      name: "September collections",
      metricType: "revenue",
      target: 70000,
      timePeriod: "monthly",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });

    const dash = await a.agent.get("/api/dashboard?period=this_week");
    expect(dash.status).toBe(200);
    const preview = await a.agent.get("/api/reports/preview?period=weekly");
    expect(preview.status).toBe(200);
    expect(preview.body.period.from).toBe("2026-09-14");
    expect(preview.body.period.to).toBe("2026-09-16");
    expect(preview.body.previousFrom).toBe("2026-09-11");
    expect(preview.body.previousTo).toBe("2026-09-13");
    expect(preview.body.comparisonDefinition).toMatch(/Equal-length window/i);
    expect(preview.body.kpis.visits.value).toBe(dash.body.kpis.visits.value);
    expect(preview.body.kpis.visits.value).toBe(10);
    expect(preview.body.kpis.visits.previousValue).toBe(5);
    expect(preview.body.kpis.visits.percentChange).toBe(100);
    expect(preview.body.kpis.revenue.value).toBe(250);
    expect(preview.body.kpis.officeVisitAverage.value).toBe(25);
    expect(preview.body.kpis.newPatients.available).toBe(true);
    expect(preview.body.kpis.newPatients.value).toBe(2);
    expect(preview.body.kpis.conversion.value).toBe(50);
    expect(preview.body.goals.emptyState).toBe("has_data");
    expect(preview.body.goals.items[0].name).toBe("September collections");
    expect(preview.body.referrals.rows[0].referralSource).toBe("Google");
    expect(preview.body.referrals.rows[0].newCount).toBe(2);
    expect(preview.body.referrals.rows[0].convertedCount).toBe(1);
    expect(preview.body.trend.grain).toBe("day");
    expect(preview.body.trend.emptyState).toBe("has_data");
    const tue = preview.body.trend.points.find(
      (p: { key: string }) => p.key === "2026-09-16",
    );
    expect(tue.visits).toBe(10);
    expect(tue.revenue).toBe(250);
    const emptyDay = preview.body.trend.points.find(
      (p: { key: string }) => p.key === "2026-09-15",
    );
    expect(emptyDay.visits).toBe(0);

    const monthly = await a.agent.get("/api/reports/preview?period=monthly");
    expect(monthly.body.period.from).toBe("2026-09-01");
    expect(monthly.body.kpis.visits.value).toBe(15);

    const quarterly = await a.agent.get("/api/reports/preview?period=quarterly");
    expect(quarterly.body.period.from).toBe("2026-07-01");
    expect(quarterly.body.trend.grain).toBe("week");
  });

  it("Practice A cannot see Practice B report data", async () => {
    const { app } = testApp();
    const a = await register(app, "rpta");
    const b = await register(app, "rptb");

    await b.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 99,
      revenue: 9900,
    });
    await b.agent.post("/api/patients").send({
      name: "Bob from B",
      referralSource: "Facebook",
      day1Date: "2026-09-16",
    });
    await b.agent.post("/api/treatments").send({
      name: "B service",
      category: "Other",
      price: 9,
    });

    const previewA = await a.agent.get("/api/reports/preview?period=weekly");
    expect(previewA.status).toBe(200);
    expect(previewA.body.kpis.visits.value).toBe(0);
    expect(previewA.body.emptyState).toBe("no_entries");
    expect(JSON.stringify(previewA.body)).not.toContain("Facebook");
    expect(JSON.stringify(previewA.body)).not.toContain("Bob from B");
    expect(JSON.stringify(previewA.body)).not.toContain("9900");

    const header = await a.agent
      .get("/api/reports/preview?period=weekly")
      .set("x-practice-id", b.body.practice.id)
      .set("x-org-id", b.body.organization.id);
    expect(header.status).toBe(403);
  });

  it("PDF export returns application/pdf for owner and staff and is audited", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "rptpdf");
    await owner.agent.post("/api/daily-log").send({
      date: "2026-09-16",
      visits: 3,
      revenue: 90,
    });

    const pdf = await owner.agent
      .get("/api/reports/export.pdf?period=weekly")
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

    const hash = (await storage.getUserByUsername("user_rptpdf"))!;
    const staffUser = await storage.createUser({
      email: "staffpdf@clinic.test",
      username: "staffpdf",
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
      (await staff.post("/api/auth/login").send({ login: "staffpdf", password: STRONG }))
        .status,
    ).toBe(200);
    const staffPdf = await staff.get("/api/reports/export.pdf?period=monthly");
    expect(staffPdf.status).toBe(200);
    expect(staffPdf.headers["content-type"]).toMatch(/application\/pdf/);

    const logs = await owner.agent.get("/api/audit-logs");
    const exported = logs.body.logs.find(
      (row: { resourceType: string; action: string }) =>
        row.resourceType === "report" && row.action === "export",
    );
    expect(exported).toBeTruthy();
    expect(exported.metadata.format).toBe("pdf");
  });

  it("rejects invalid report periods and from-after-to custom ranges", async () => {
    const { app } = testApp();
    const a = await register(app, "rptbad");
    expect((await a.agent.get("/api/reports/preview?period=nope")).status).toBe(400);
    expect(
      (await a.agent.get("/api/reports/preview?period=custom&from=2026-09-16&to=2026-09-01"))
        .status,
    ).toBe(400);
  });
});
