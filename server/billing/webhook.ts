import type { Request, Response } from "express";
import type Stripe from "stripe";
import {
  isSubscriptionStatus,
  type SubscriptionStatus,
} from "@shared/billing";
import { logAudit } from "../audit/logAudit";
import type { HttpContext } from "../http-context";
import { logError, logWarn } from "../log/redact";
import type { OrganizationPatch, StoredOrganization } from "../storage/types";
import { constructWebhookEvent } from "./stripe";

function idOf(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  ) {
    return (value as { id: string }).id;
  }
  return undefined;
}

function metadataOrgId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const orgId = (value as { orgId?: unknown }).orgId;
  return typeof orgId === "string" && orgId.length > 0 ? orgId : undefined;
}

function mapStripeStatus(status: string | undefined): SubscriptionStatus {
  if (status && isSubscriptionStatus(status)) return status;
  if (
    status === "unpaid" ||
    status === "incomplete_expired" ||
    status === "paused"
  ) {
    return "canceled";
  }
  return "incomplete";
}

function planFromSubscription(sub: Record<string, unknown>): string | undefined {
  const items = sub.items as { data?: Array<{ price?: Record<string, unknown> }> } | undefined;
  const price = items?.data?.[0]?.price;
  if (!price) return undefined;
  for (const key of ["nickname", "lookup_key", "id"] as const) {
    const value = price[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function trialEndFromUnix(value: unknown): Date | null | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number") return undefined;
  return new Date(value * 1000);
}

async function findOrg(
  ctx: HttpContext,
  hints: {
    orgId?: string;
    customerId?: string;
    subscriptionId?: string;
  },
): Promise<StoredOrganization | undefined> {
  if (hints.orgId) {
    const byId = await ctx.storage.getOrganization(hints.orgId);
    if (byId) return byId;
  }
  if (hints.customerId) {
    const byCustomer = await ctx.storage.getOrganizationByStripeCustomerId(
      hints.customerId,
    );
    if (byCustomer) return byCustomer;
  }
  if (hints.subscriptionId) {
    return ctx.storage.getOrganizationByStripeSubscriptionId(hints.subscriptionId);
  }
  return undefined;
}

async function auditBilling(
  ctx: HttpContext,
  org: StoredOrganization,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const practices = await ctx.storage.listPracticesForOrg(org.id);
  const first = practices[0];
  if (!first) return;
  await logAudit(ctx.storage, {
    orgId: org.id,
    practiceId: first.id,
    actorId: null,
    action,
    resourceType: "billing",
    resourceId: org.id,
    metadata,
    ipAddress: null,
  });
}

async function applySubscriptionObject(
  ctx: HttpContext,
  sub: Record<string, unknown>,
  extra: OrganizationPatch,
  action: string,
  eventId: string,
  eventType: string,
): Promise<void> {
  const customerId = idOf(sub.customer);
  const subscriptionId = idOf(sub.id) ?? idOf(sub);
  const org = await findOrg(ctx, {
    orgId: metadataOrgId(sub.metadata),
    customerId,
    subscriptionId,
  });
  if (!org) {
    logWarn("[billing] webhook org not found", { eventId, eventType });
    return;
  }
  const status = extra.subscriptionStatus ?? mapStripeStatus(String(sub.status ?? ""));
  const plan = extra.plan ?? planFromSubscription(sub) ?? org.plan;
  const trialEndsAt =
    extra.trialEndsAt !== undefined
      ? extra.trialEndsAt
      : (trialEndFromUnix(sub.trial_end) ?? org.trialEndsAt);
  await ctx.storage.updateOrganization(org.id, {
    stripeCustomerId: customerId ?? org.stripeCustomerId,
    stripeSubscriptionId: subscriptionId ?? org.stripeSubscriptionId,
    subscriptionStatus: status,
    plan,
    trialEndsAt,
    ...extra,
  });
  await auditBilling(ctx, org, action, {
    eventId,
    eventType,
    status,
    plan,
  });
}

export async function applyStripeEvent(
  ctx: HttpContext,
  event: Stripe.Event,
): Promise<void> {
  const object = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case "checkout.session.completed": {
      const orgId =
        metadataOrgId(object.metadata) ??
        (typeof object.client_reference_id === "string"
          ? object.client_reference_id
          : undefined);
      const customerId = idOf(object.customer);
      const subscriptionId = idOf(object.subscription);
      const org = await findOrg(ctx, { orgId, customerId, subscriptionId });
      if (!org) {
        logWarn("[billing] checkout org not found", { eventId: event.id });
        return;
      }
      await ctx.storage.updateOrganization(org.id, {
        stripeCustomerId: customerId ?? org.stripeCustomerId,
        stripeSubscriptionId: subscriptionId ?? org.stripeSubscriptionId,
        subscriptionStatus: "active",
      });
      await auditBilling(ctx, org, "billing_checkout_completed", {
        eventId: event.id,
        eventType: event.type,
        status: "active",
      });
      return;
    }
    case "customer.subscription.updated": {
      await applySubscriptionObject(
        ctx,
        object,
        {},
        "billing_subscription_updated",
        event.id,
        event.type,
      );
      return;
    }
    case "customer.subscription.deleted": {
      await applySubscriptionObject(
        ctx,
        object,
        { subscriptionStatus: "canceled" },
        "billing_subscription_deleted",
        event.id,
        event.type,
      );
      return;
    }
    case "invoice.payment_failed": {
      const customerId = idOf(object.customer);
      const subscriptionId = idOf(object.subscription);
      const org = await findOrg(ctx, {
        orgId: metadataOrgId(object.metadata),
        customerId,
        subscriptionId,
      });
      if (!org) {
        logWarn("[billing] invoice org not found", { eventId: event.id });
        return;
      }
      await ctx.storage.updateOrganization(org.id, {
        subscriptionStatus: "past_due",
        stripeCustomerId: customerId ?? org.stripeCustomerId,
        stripeSubscriptionId: subscriptionId ?? org.stripeSubscriptionId,
      });
      await auditBilling(ctx, org, "billing_payment_failed", {
        eventId: event.id,
        eventType: event.type,
        status: "past_due",
      });
      return;
    }
    default:
      return;
  }
}

export async function handleStripeWebhook(
  req: Request,
  res: Response,
  ctx: HttpContext,
): Promise<void> {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string" || !signature) {
    res.status(400).json({ error: "missing_signature" });
    return;
  }
  if (!ctx.billing.webhookSecret) {
    res.status(503).json({ error: "billing_not_configured" });
    return;
  }
  const payload: string | Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === "string"
      ? req.body
      : Buffer.from(JSON.stringify(req.body ?? {}));

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(payload, signature, ctx.billing.webhookSecret);
  } catch {
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  try {
    await applyStripeEvent(ctx, event);
  } catch (err) {
    logError("[billing] webhook handler failed", {
      eventId: event.id,
      eventType: event.type,
      error: err instanceof Error ? err.message : "unknown",
    });
    res.status(500).json({ error: "webhook_handler_failed" });
    return;
  }
  res.json({ received: true });
}
