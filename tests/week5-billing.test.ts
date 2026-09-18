import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth/password";
import { assertNoPhiInStripePayload } from "../server/billing/phi-guard";
import {
  generateTestWebhookHeader,
  type BillingStripe,
} from "../server/billing/stripe";
import { loadConfig } from "../server/config";
import { loadEnvFile } from "../server/load-env";
import { createMemoryStorage } from "../server/storage/memory";
import type { MemoryStorage } from "../server/storage/memory";

const STRONG = "CorrectHorse-Battery9!";
const SESSION_SECRET = "test-session-secret-not-for-production";
const MFA_KEY = "test-mfa-encryption-key-min-32-chars!!";
const PHI_KEY = "test-phi-encryption-key-min-32-chars!!";
const WEBHOOK_SECRET = "whsec_test_week5_not_a_real_secret";
const PRICE_ID = "price_test_starter";

type FakeStripe = BillingStripe & {
  customersCreated: Array<{ name: string; email: string; metadata?: Record<string, string> }>;
};

function createFakeStripe(): FakeStripe {
  const customersCreated: FakeStripe["customersCreated"] = [];
  let n = 0;
  return {
    customersCreated,
    customers: {
      create: async (params) => {
        customersCreated.push(params);
        n += 1;
        return { id: `cus_test_${n}` };
      },
    },
    checkout: {
      sessions: {
        create: async () => {
          return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async () => {
          return { url: "https://billing.stripe.com/p/session/test" };
        },
      },
    },
  };
}

function testApp(opts?: {
  storage?: MemoryStorage;
  stripe?: BillingStripe | null;
  enforce?: boolean;
  requireStripe?: boolean;
  webhookSecret?: string;
  priceId?: string;
}) {
  const storage = opts?.storage ?? createMemoryStorage({ phiEncryptionKey: PHI_KEY });
  const stripe = opts?.stripe === undefined ? null : opts.stripe;
  const app = createApp({
    storage,
    mfaEncryptionKey: MFA_KEY,
    publicBaseUrl: "http://localhost:5000",
    billing: {
      stripe,
      webhookSecret: opts?.webhookSecret ?? WEBHOOK_SECRET,
      priceId: opts?.priceId ?? PRICE_ID,
      requireStripe: opts?.requireStripe ?? false,
      enforce: opts?.enforce ?? false,
      trialDays: 14,
      defaultPlan: "starter",
    },
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

async function addMember(
  storage: MemoryStorage,
  opts: {
    email: string;
    username: string;
    role: "readonly" | "staff" | "clinician" | "admin";
    orgId: string;
    practiceId: string;
  },
) {
  const user = await storage.createUser({
    email: opts.email,
    username: opts.username,
    passwordHash: await hashPassword(STRONG),
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

function stripeEvent(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${type.replace(/\./g, "_")}`,
    object: "event",
    type,
    data: { object },
  };
}

function signedWebhook(event: object, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = generateTestWebhookHeader(payload, secret);
  return { payload, signature };
}

describe("dotenv / production fail-fast", () => {
  const prodBase = {
    NODE_ENV: "production",
    SESSION_SECRET: "a".repeat(32),
    MFA_ENCRYPTION_KEY: "b".repeat(32),
    PHI_ENCRYPTION_KEY: "c".repeat(32),
    DATABASE_URL: "postgres://app:strong@db.internal:5432/chirokpi",
  };

  it("does not load .env in production", () => {
    const load = vi.fn();
    loadEnvFile({ NODE_ENV: "production" }, load);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads .env in development without override", () => {
    const load = vi.fn();
    loadEnvFile({ NODE_ENV: "development" }, load);
    expect(load).toHaveBeenCalledWith({ override: false });
  });

  it("still fail-fasts in production without core secrets", () => {
    expect(() =>
      loadConfig({ ...prodBase, SESSION_SECRET: "" }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      loadConfig({ ...prodBase, DATABASE_URL: "" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("fail-fasts in production when Stripe is required but missing", () => {
    expect(() =>
      loadConfig({ ...prodBase, BILLING_REQUIRE_STRIPE: "true" }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("allows production boot without Stripe when not required", () => {
    const cfg = loadConfig(prodBase);
    expect(cfg.billingRequireStripe).toBe(false);
    expect(cfg.billingEnforce).toBe(true);
    expect(cfg.stripeSecretKey).toBeUndefined();
  });
});

describe("register + Stripe customer (no PHI)", () => {
  it("records a local trial without Stripe and still registers", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "trialonly");
    const org = await storage.getOrganization(owner.body.organization.id);
    expect(org?.subscriptionStatus).toBe("trialing");
    expect(org?.plan).toBe("starter");
    expect(org?.stripeCustomerId).toBeNull();
    expect(org?.trialEndsAt).toBeTruthy();
  });

  it("creates a Stripe customer with org name and owner email only", async () => {
    const fake = createFakeStripe();
    const { app, storage } = testApp({ stripe: fake });
    const owner = await register(app, "stripecust");
    expect(fake.customersCreated).toHaveLength(1);
    expect(fake.customersCreated[0]).toEqual({
      name: "Org stripecust",
      email: "stripecust@clinic.test",
      metadata: { orgId: owner.body.organization.id },
    });
    const org = await storage.getOrganization(owner.body.organization.id);
    expect(org?.stripeCustomerId).toBe("cus_test_1");
  });

  it("does not create a second Stripe customer for an additional practice", async () => {
    const fake = createFakeStripe();
    const { app, storage } = testApp({ stripe: fake });
    const owner = await register(app, "twosites");
    const created = await owner.agent.post("/api/practices").send({
      orgId: owner.body.organization.id,
      name: "Second location",
    });
    expect(created.status).toBe(201);
    expect(fake.customersCreated).toHaveLength(1);
    const org = await storage.getOrganization(owner.body.organization.id);
    expect(org?.stripeCustomerId).toBe("cus_test_1");
  });

  it("staff cannot create an additional practice", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "staffprac");
    await addMember(storage, {
      email: "staff.prac@clinic.test",
      username: "staff_prac",
      role: "staff",
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
    });
    const staff = request.agent(app);
    const login = await staff.post("/api/auth/login").send({
      login: "staff.prac@clinic.test",
      password: STRONG,
    });
    expect(login.status).toBe(200);
    const denied = await staff.post("/api/practices").send({
      orgId: owner.body.organization.id,
      name: "Should not exist",
    });
    expect(denied.status).toBe(403);
  });
});

describe("checkout and portal RBAC", () => {
  it("owner can open checkout and portal; staff cannot", async () => {
    const fake = createFakeStripe();
    const { app, storage } = testApp({ stripe: fake });
    const owner = await register(app, "billrbac");

    const checkout = await owner.agent.post("/api/billing/checkout-session");
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const portal = await owner.agent.post("/api/billing/portal-session");
    expect(portal.status).toBe(200);
    expect(portal.body.url).toMatch(/^https:\/\/billing\.stripe\.com\//);

    await addMember(storage, {
      email: "staffbill@clinic.test",
      username: "staff_bill",
      role: "staff",
      orgId: owner.body.organization.id,
      practiceId: owner.body.practice.id,
    });
    const staff = request.agent(app);
    await staff.post("/api/auth/login").send({
      login: "staffbill@clinic.test",
      password: STRONG,
    });
    const staffCheckout = await staff.post("/api/billing/checkout-session");
    expect(staffCheckout.status).toBe(403);
    const staffPortal = await staff.post("/api/billing/portal-session");
    expect(staffPortal.status).toBe(403);

    const staffStatus = await staff.get("/api/billing/status");
    expect(staffStatus.status).toBe(200);
    expect(staffStatus.body.subscriptionStatus).toBe("trialing");
  });
});

describe("webhook signature + subscription updates", () => {
  it("rejects an invalid Stripe signature", async () => {
    const { app } = testApp();
    const payload = JSON.stringify(stripeEvent("customer.subscription.updated", {}));
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=deadbeef")
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_signature");
  });

  it("rejects a missing signature", async () => {
    const { app } = testApp();
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send("{}");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_signature");
  });

  it("applies a signed customer.subscription.updated event", async () => {
    const fake = createFakeStripe();
    const { app, storage } = testApp({ stripe: fake });
    const owner = await register(app, "whupdate");
    const orgId = owner.body.organization.id as string;
    await storage.updateOrganization(orgId, { stripeCustomerId: "cus_wh_1" });

    const { payload, signature } = signedWebhook(
      stripeEvent("customer.subscription.updated", {
        id: "sub_wh_1",
        object: "subscription",
        customer: "cus_wh_1",
        status: "active",
        metadata: { orgId },
      }),
    );
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const org = await storage.getOrganization(orgId);
    expect(org?.subscriptionStatus).toBe("active");
    expect(org?.stripeSubscriptionId).toBe("sub_wh_1");

    const logs = await storage.listAuditLogs({
      orgId,
      practiceId: owner.body.practice.id,
    });
    expect(logs.map((l) => l.action)).toContain("billing_subscription_updated");
    const billingLog = logs.find((l) => l.action === "billing_subscription_updated");
    expect(JSON.stringify(billingLog?.metadata ?? {})).not.toMatch(/clinic\.test/);
  });

  it("sets past_due on invoice.payment_failed", async () => {
    const { app, storage } = testApp();
    const owner = await register(app, "pastdue");
    const orgId = owner.body.organization.id as string;
    await storage.updateOrganization(orgId, { stripeCustomerId: "cus_fail_1" });
    const { payload, signature } = signedWebhook(
      stripeEvent("invoice.payment_failed", {
        id: "in_fail_1",
        customer: "cus_fail_1",
        status: "open",
      }),
    );
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
    expect(res.status).toBe(200);
    const org = await storage.getOrganization(orgId);
    expect(org?.subscriptionStatus).toBe("past_due");
  });
});

describe("entitlement gate", () => {
  it("blocks PHI writes when BILLING_ENFORCE=true and status is canceled", async () => {
    const { app, storage } = testApp({ enforce: true });
    const owner = await register(app, "gated");
    const orgId = owner.body.organization.id as string;
    const practiceId = owner.body.practice.id as string;

    const duringTrial = await owner.agent.post("/api/patients").send({ name: "Trial Patient" });
    expect(duringTrial.status).toBe(201);

    await storage.updateOrganization(orgId, { subscriptionStatus: "canceled" });

    const blocked = await owner.agent.post("/api/patients").send({ name: "Should Block" });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe("subscription_inactive");

    const listed = await owner.agent.get("/api/patients");
    expect(listed.status).toBe(200);
    expect(listed.body.patients).toHaveLength(1);

    const invite = await owner.agent.post(`/api/practices/${practiceId}/invites`).send({
      email: "unpaid-hire@clinic.test",
      role: "staff",
    });
    expect(invite.status).toBe(201);
  });

  it("does not block PHI writes when enforcement is off", async () => {
    const { app, storage } = testApp({ enforce: false });
    const owner = await register(app, "softgate");
    await storage.updateOrganization(owner.body.organization.id, {
      subscriptionStatus: "canceled",
    });
    const created = await owner.agent.post("/api/patients").send({ name: "Still Allowed" });
    expect(created.status).toBe(201);
  });
});

describe("PHI guard", () => {
  it("refuses Stripe payloads with patient-like keys", () => {
    expect(() =>
      assertNoPhiInStripePayload({ metadata: { patientName: "Alice" } }),
    ).toThrow(/PHI-like key/);
    expect(() =>
      assertNoPhiInStripePayload({
        name: "Org",
        email: "owner@clinic.test",
        metadata: { orgId: "org-1" },
      }),
    ).not.toThrow();
  });
});
