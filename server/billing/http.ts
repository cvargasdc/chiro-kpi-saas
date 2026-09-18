import type { Express } from "express";
import { ORG_ADMIN_ROLES } from "@shared/roles";
import {
  authenticate,
  requireOrgAccess,
  requireOrgRole,
} from "../auth/middleware";
import type { HttpContext } from "../http-context";
import { logError } from "../log/redact";
import { publicBillingStatus } from "./entitlement";
import { assertNoPhiInStripePayload } from "./phi-guard";
import { ensureStripeCustomer } from "./provision";

export function registerBillingRoutes(app: Express, ctx: HttpContext): void {
  const { storage } = ctx;
  const auth = authenticate(storage);
  const orgGate = requireOrgAccess(storage);
  const adminGate = requireOrgRole(...ORG_ADMIN_ROLES);

  app.get("/api/billing/status", auth, orgGate, async (req, res) => {
    const org = await storage.getOrganization(req.orgAccess!.orgId);
    if (!org) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(
      publicBillingStatus(org, { enforce: ctx.billing.enforce, now: ctx.now() }),
    );
  });

  app.post(
    "/api/billing/checkout-session",
    auth,
    orgGate,
    adminGate,
    async (req, res) => {
      if (!ctx.billing.stripe || !ctx.billing.priceId) {
        return res.status(503).json({ error: "billing_not_configured" });
      }
      const org = await storage.getOrganization(req.orgAccess!.orgId);
      if (!org) {
        return res.status(404).json({ error: "not_found" });
      }
      try {
        const withCustomer = await ensureStripeCustomer({
          storage,
          stripe: ctx.billing.stripe,
          org,
          ownerEmail: req.currentUser!.email,
        });
        const base = ctx.publicBaseUrl.replace(/\/$/, "");
        const params = {
          mode: "subscription" as const,
          customer: withCustomer.stripeCustomerId!,
          line_items: [{ price: ctx.billing.priceId, quantity: 1 }],
          success_url: `${base}/?billing=success`,
          cancel_url: `${base}/?billing=cancel`,
          client_reference_id: org.id,
          metadata: { orgId: org.id },
          subscription_data: { metadata: { orgId: org.id } },
        };
        assertNoPhiInStripePayload(params);
        const session = await ctx.billing.stripe.checkout.sessions.create(params);
        if (!session.url) {
          return res.status(502).json({ error: "checkout_url_missing" });
        }
        res.json({ url: session.url, id: session.id });
      } catch (err) {
        logError("[billing] checkout session failed", {
          orgId: org.id,
          error: err instanceof Error ? err.message : "unknown",
        });
        res.status(502).json({ error: "checkout_failed" });
      }
    },
  );

  app.post(
    "/api/billing/portal-session",
    auth,
    orgGate,
    adminGate,
    async (req, res) => {
      if (!ctx.billing.stripe) {
        return res.status(503).json({ error: "billing_not_configured" });
      }
      const org = await storage.getOrganization(req.orgAccess!.orgId);
      if (!org) {
        return res.status(404).json({ error: "not_found" });
      }
      try {
        const withCustomer = await ensureStripeCustomer({
          storage,
          stripe: ctx.billing.stripe,
          org,
          ownerEmail: req.currentUser!.email,
        });
        if (!withCustomer.stripeCustomerId) {
          return res.status(409).json({ error: "billing_customer_missing" });
        }
        const params = {
          customer: withCustomer.stripeCustomerId,
          return_url: ctx.publicBaseUrl.replace(/\/$/, "") + "/",
        };
        assertNoPhiInStripePayload(params);
        const session = await ctx.billing.stripe.billingPortal.sessions.create(
          params,
        );
        res.json({ url: session.url });
      } catch (err) {
        logError("[billing] portal session failed", {
          orgId: org.id,
          error: err instanceof Error ? err.message : "unknown",
        });
        res.status(502).json({ error: "portal_failed" });
      }
    },
  );
}
