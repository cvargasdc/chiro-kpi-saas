# Week 5 — Stripe subscriptions, practice provisioning, dotenv

Path B isolation (`org_id` + `practice_id` on PHI) is unchanged. No OpenAI. No ChiroTouch parsers. Live Replit / chiro-kpi.com was not touched.

Billing is **per organization**. Additional practices under the same org inherit that subscription. There is no Stripe Customer per location.

This is test-mode scaffolding — not a claim that the product is HIPAA certified, and **not** permission to send PHI to Stripe.

---

## What landed

| Area | Behavior |
|------|----------|
| Dotenv | `server/load-env.ts` loads `.env` at process boot in non-production. Already-set `process.env` values are **not** overridden. `npm run dev` does not need `source .env`. Production skips the file (Secrets Manager / platform env). |
| Org billing columns | `stripeCustomerId`, `stripeSubscriptionId`, `plan`, `subscriptionStatus` (`trialing\|active\|past_due\|canceled\|incomplete`), `trialEndsAt`. Unused `billing_customer_id` was replaced. Tenant keys unchanged. |
| Register / first org | Records a local trial (`BILLING_TRIAL_DAYS`, default 14). If a Stripe client is configured, creates a Customer with **org name** + **owner workforce email** only. |
| Checkout | `POST /api/billing/checkout-session` → hosted Checkout URL. Owner\|admin. |
| Customer portal | `POST /api/billing/portal-session` → Billing Portal URL. Owner\|admin. |
| Webhook | `POST /api/billing/webhook` uses the **raw body** and `Stripe.webhooks.constructEvent`. Handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. |
| Entitlement | `requireActiveSubscription` on PHI **writes** (create/update/delete patient). Off unless `BILLING_ENFORCE=true` (default **false** in development; **true** in production unless `BILLING_ENFORCE=false`). Invites still work for unpaid/trial orgs. |
| Status | `GET /api/billing/status` — any org member. Dashboard shows plan/status plus Subscribe / Manage billing. |

---

## No PHI in Stripe

Never send to Stripe (metadata, customer fields, description, receipts, invoice custom fields):

- Patient names
- Patient emails or phone numbers
- Date of birth
- Condition, intake notes, MRN, SSN
- Anything joinable to a named patient

Allowed: organization name, owner/admin **workforce** email, `metadata.orgId`, plan/price ids.

`server/billing/phi-guard.ts` refuses payloads whose keys look like PHI. That is a backstop, not a license to get creative.

Stripe's HIPAA support is limited. Treat Stripe as **not a PHI store**. See [BAA-VENDORS.md](./BAA-VENDORS.md).

---

## Stripe test mode

1. Create a Stripe account and stay in **test mode**.
2. Create a Product + recurring Price. Copy `price_…` into `STRIPE_PRICE_ID`.
3. Copy the **test** secret and publishable keys (`sk_test_…`, `pk_test_…`). Never commit `sk_live_`.
4. Local webhook forwarding:

```bash
cp .env.example .env
# fill SESSION_SECRET, MFA_ENCRYPTION_KEY, PHI_ENCRYPTION_KEY, and Stripe test keys

docker compose up -d
npx drizzle-kit push
npm run dev

# another terminal
stripe listen --forward-to localhost:5000/api/billing/webhook
```

`stripe listen` prints `whsec_…`. Put that in `STRIPE_WEBHOOK_SECRET` (restart `npm run dev` after editing `.env`).

Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

Checkout and the portal open Stripe-hosted pages. Success returns to `APP_BASE_URL/?billing=success`.

---

## Environment

```
STRIPE_SECRET_KEY=sk_test_…          # test mode only
STRIPE_PUBLISHABLE_KEY=pk_test_…     # docs / later Stripe.js; Checkout Session URL does not need it
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_ID=price_…
BILLING_REQUIRE_STRIPE=false         # local trial even if Stripe is down
BILLING_ENFORCE=false                # default false in development
BILLING_TRIAL_DAYS=14
```

`BILLING_REQUIRE_STRIPE=true` in production also fail-fasts if the Stripe secret, webhook secret, or price id is missing.

`npm test` injects a fake Stripe client (or none). It does **not** call the network.

---

## APIs

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/api/billing/status` | any org member | plan, status, trial end, entitled |
| POST | `/api/billing/checkout-session` | owner\|admin | `{ url, id }` |
| POST | `/api/billing/portal-session` | owner\|admin | `{ url }` |
| POST | `/api/billing/webhook` | Stripe signature | raw JSON body |

PHI-mutating patient routes return `402 subscription_inactive` when enforcement is on and status is not `trialing` or `active` (expired trials count as not entitled).

Additional `POST /api/practices` locations are owner\|admin and **do not** create a second Stripe customer.

---

## Audit

Billing events: `billing_customer_provisioned`, `billing_checkout_completed`, `billing_subscription_updated`, `billing_subscription_deleted`, `billing_payment_failed`.

Metadata is event id, type, status, plan — **no email, no patient fields**.

---

## Out of this week

- Daily Log / Dashboard KPIs
- Live Stripe (production keys)
- Resend / S3
- Postgres RLS
- Real App Runner deploy
