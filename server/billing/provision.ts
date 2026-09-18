import { logAudit } from "../audit/logAudit";
import { logError, logWarn } from "../log/redact";
import type { AppStorage, StoredOrganization } from "../storage/types";
import type { BillingStripe } from "./stripe";
import { assertNoPhiInStripePayload, orgBillingCustomerParams } from "./phi-guard";

export async function provisionOrgBilling(input: {
  storage: AppStorage;
  stripe: BillingStripe | null;
  requireStripe: boolean;
  trialDays: number;
  defaultPlan: string;
  now: Date;
  org: StoredOrganization;
  ownerEmail: string;
  actorId: string;
  practiceId: string | null;
  ipAddress: string | null;
}): Promise<StoredOrganization> {
  const trialEndsAt = new Date(
    input.now.getTime() + input.trialDays * 24 * 60 * 60 * 1000,
  );
  let stripeCustomerId = input.org.stripeCustomerId;

  if (input.stripe) {
    try {
      const params = orgBillingCustomerParams({
        orgId: input.org.id,
        orgName: input.org.name,
        ownerEmail: input.ownerEmail,
      });
      assertNoPhiInStripePayload(params);
      const customer = await input.stripe.customers.create(params);
      stripeCustomerId = customer.id;
    } catch (err) {
      logError("[billing] stripe customer create failed", {
        orgId: input.org.id,
        error: err instanceof Error ? err.message : "unknown",
      });
      if (input.requireStripe) {
        throw err;
      }
    }
  } else if (input.requireStripe) {
    logWarn("[billing] BILLING_REQUIRE_STRIPE=true but no Stripe client; local trial only", {
      orgId: input.org.id,
    });
  }

  const updated = await input.storage.updateOrganization(input.org.id, {
    plan: input.defaultPlan,
    subscriptionStatus: "trialing",
    trialEndsAt,
    stripeCustomerId,
  });
  const org = updated ?? {
    ...input.org,
    plan: input.defaultPlan,
    subscriptionStatus: "trialing" as const,
    trialEndsAt,
    stripeCustomerId,
  };

  if (input.practiceId) {
    await logAudit(input.storage, {
      orgId: org.id,
      practiceId: input.practiceId,
      actorId: input.actorId,
      action: "billing_customer_provisioned",
      resourceType: "billing",
      resourceId: org.id,
      metadata: {
        hasStripeCustomer: Boolean(org.stripeCustomerId),
        plan: org.plan,
        subscriptionStatus: org.subscriptionStatus,
      },
      ipAddress: input.ipAddress,
    });
  }

  return org;
}

export async function ensureStripeCustomer(input: {
  storage: AppStorage;
  stripe: BillingStripe;
  org: StoredOrganization;
  ownerEmail: string;
}): Promise<StoredOrganization> {
  if (input.org.stripeCustomerId) return input.org;
  const params = orgBillingCustomerParams({
    orgId: input.org.id,
    orgName: input.org.name,
    ownerEmail: input.ownerEmail,
  });
  assertNoPhiInStripePayload(params);
  const customer = await input.stripe.customers.create(params);
  const updated = await input.storage.updateOrganization(input.org.id, {
    stripeCustomerId: customer.id,
  });
  return updated ?? { ...input.org, stripeCustomerId: customer.id };
}
