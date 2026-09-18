import type { NextFunction, Request, Response } from "express";
import {
  isEntitledSubscriptionStatus,
  type SubscriptionStatus,
} from "@shared/billing";
import type { StoredOrganization } from "../storage/types";
import type { HttpContext } from "../http-context";

export function isOrgEntitled(org: StoredOrganization, now: Date): boolean {
  if (org.subscriptionStatus === "trialing") {
    if (org.trialEndsAt && org.trialEndsAt.getTime() <= now.getTime()) {
      return false;
    }
    return true;
  }
  return isEntitledSubscriptionStatus(org.subscriptionStatus);
}

/**
 * Soft/hard gate for PHI-mutating routes.
 * When `BILLING_ENFORCE` is false (default in development), this is a no-op.
 */
export function requireActiveSubscription(ctx: HttpContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!ctx.billing.enforce) {
      return next();
    }
    const orgId = req.tenant?.orgId ?? req.orgAccess?.orgId;
    if (!orgId) {
      return res.status(400).json({ error: "org_id_required" });
    }
    const org = await ctx.storage.getOrganization(orgId);
    if (!org || !isOrgEntitled(org, ctx.now())) {
      const status: SubscriptionStatus | "unknown" =
        org?.subscriptionStatus ?? "unknown";
      return res.status(402).json({
        error: "subscription_inactive",
        subscriptionStatus: status,
      });
    }
    next();
  };
}

export function publicBillingStatus(
  org: StoredOrganization,
  opts: { enforce: boolean; now: Date },
) {
  const entitled = opts.enforce ? isOrgEntitled(org, opts.now) : true;
  return {
    plan: org.plan,
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt: org.trialEndsAt ? org.trialEndsAt.toISOString() : null,
    stripeCustomerId: org.stripeCustomerId,
    hasStripeCustomer: Boolean(org.stripeCustomerId),
    entitled,
    enforce: opts.enforce,
  };
}
