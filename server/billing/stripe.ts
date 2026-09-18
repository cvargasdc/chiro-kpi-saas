import Stripe from "stripe";

/**
 * Narrow Stripe surface used by billing routes. Tests inject a fake that
 * implements this — no network. The real client is `createStripeClient`.
 *
 * Customer payloads must be org/practice billing identity only. Never send
 * patient names, patient emails, DOB, or other PHI (see assertNoPhiInStripePayload).
 */
export type BillingStripe = {
  customers: {
    create: (params: {
      name: string;
      email: string;
      metadata?: Record<string, string>;
    }) => Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create: (params: {
        mode: "subscription";
        customer: string;
        line_items: Array<{ price: string; quantity: number }>;
        success_url: string;
        cancel_url: string;
        client_reference_id?: string;
        metadata?: Record<string, string>;
        subscription_data?: { metadata?: Record<string, string> };
      }) => Promise<{ id: string; url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create: (params: { customer: string; return_url: string }) => Promise<{
        url: string;
      }>;
    };
  };
};

export type BillingContext = {
  stripe: BillingStripe | null;
  webhookSecret: string;
  priceId: string;
  publishableKey: string;
  requireStripe: boolean;
  enforce: boolean;
  trialDays: number;
  defaultPlan: string;
};

export function defaultBillingContext(
  overrides?: Partial<BillingContext>,
): BillingContext {
  return {
    stripe: overrides?.stripe ?? null,
    webhookSecret: overrides?.webhookSecret ?? "",
    priceId: overrides?.priceId ?? "",
    publishableKey: overrides?.publishableKey ?? "",
    requireStripe: overrides?.requireStripe ?? false,
    enforce: overrides?.enforce ?? false,
    trialDays: overrides?.trialDays ?? 14,
    defaultPlan: overrides?.defaultPlan ?? "starter",
  };
}

export function createStripeClient(secretKey: string): BillingStripe {
  return new Stripe(secretKey) as unknown as BillingStripe;
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  secret: string,
): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}

export function generateTestWebhookHeader(
  payload: string,
  secret: string,
): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}
