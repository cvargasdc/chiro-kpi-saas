# Chiro-KPI (Path B rebuild)

Multi-tenant practice KPI software for chiropractic clinics. This tree is a **greenfield rebuild**, not a copy of the live Replit app.

**Path B:** treat patient identity, contact, clinical notes, and joinable operational rows as **ePHI from day one**.

Week 5 adds Stripe test-mode subscriptions (org-level, no PHI in Stripe), practice provisioning polish, and dotenv auto-load on top of Week 4 hardening. It does **not** replace chiro-kpi.com and is **not** a HIPAA certification.

---

## For Chris Vargas — what this is

| In v1 / this foundation | Out (do not expect them here) |
|-------------------------|--------------------------------|
| Organizations → practices → memberships | Replit Auth / impersonation |
| Full PHI posture + audit log + owner/admin audit API | OpenAI (no client, no mapping) |
| Email/username + password, bcrypt, session cookies, TOTP MFA | ChiroTouch EOD parsers |
| RBAC: owner, admin, clinician, staff, readonly | SimplePractice-specific import |
| Password reset + practice invites (email stub) | Live Resend (adapter documented) |
| Stripe test-mode org subscriptions (no PHI) | Live Stripe keys / patient data in Stripe |
| Patient CRUD stubs, isolated by practice | S3 / Daily Log / Dashboard product |
| App-layer AES-256-GCM on patient email/phone/DOB | Hardcoded demo secrets |
| CSV/Excel import **placeholder only** | Any deploy to Replit or production |
| Local Docker Postgres + backup script skeleton | GitHub holding production PHI |
| Helmet, production fail-fast secrets, CI workflow | |

Read next:

- [docs/WEEK5-BILLING.md](docs/WEEK5-BILLING.md) — Stripe test mode, webhooks, no-PHI rule
- [docs/WEEK4-HARDENING.md](docs/WEEK4-HARDENING.md) — headers, encryption, audit API, backups, CI
- [docs/SECRETS.md](docs/SECRETS.md) — env var → Secrets Manager names
- [docs/BACKUPS.md](docs/BACKUPS.md) — dump/restore drill
- [docs/DEPLOY-STAGING.md](docs/DEPLOY-STAGING.md) — App Runner / BAA checklist
- [docs/WEEK3-AUTH.md](docs/WEEK3-AUTH.md) — password reset, invites, TOTP MFA
- [docs/WEEK2-FOUNDATION.md](docs/WEEK2-FOUNDATION.md) — schema, isolation, audit skeleton
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) — threats and controls
- [docs/BAA-VENDORS.md](docs/BAA-VENDORS.md) — AWS, Stripe, Resend in; **OpenAI out**; GitHub is not a BAA vendor
- [WEEK1-BRIEFING.md](WEEK1-BRIEFING.md) — inventory of the legacy app

---

## Stack

TypeScript, React 18, Vite, Express, Drizzle ORM, PostgreSQL, Tailwind. Tests: Vitest. CI: GitHub Actions.

---

## Run locally

You need Node 20+ and Docker (for Postgres).

```bash
cp .env.example .env
# Set SESSION_SECRET, MFA_ENCRYPTION_KEY, and PHI_ENCRYPTION_KEY to long random values:
#   openssl rand -hex 32
# PHI_ENCRYPTION_KEY must be different from MFA_ENCRYPTION_KEY.

docker compose up -d
npm install
npx drizzle-kit push
npm run dev
```

`npm run dev` auto-loads `.env` via `dotenv` (development only). Values already set in the environment are **not** overridden, so you do not need `source .env`. Production does not read a `.env` file.

Open [http://localhost:5000](http://localhost:5000). Register a user — that creates an organization, a practice, and a local billing trial. The dashboard shows the practice name, plan, and subscription status.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm test` | Isolation, auth, encryption, audit, billing (mocked Stripe), schema tests |
| `npm run check` | TypeScript |
| `npm run build` | Production client bundle → `dist/public` |
| `npm run db:push` | Push Drizzle schema to local Postgres |
| `npm run backup:db` | `pg_dump` into `backups/` (gitignored). No-ops if tools are missing |

`npm test` does **not** need Postgres. It uses an in-memory store.

---

## Tenant isolation (the non-negotiable)

PHI helpers refuse to run without both `orgId` and `practiceId`. There is no `"default"` practice.

Automated tests assert **Practice A cannot read Practice B patients**, including by UUID and by spoofed `X-Practice-Id`.

To see the test fail when the filter is removed: delete the `practiceId` predicate in `MemoryStorage.listPatients` and re-run `npm test`. Details in [docs/WEEK2-FOUNDATION.md](docs/WEEK2-FOUNDATION.md).

---

## Audit retention

`logAudit(...)` is wired into patient CRUD, auth (login/logout/MFA/password reset), invites, and org/practice create. Owner and admin can page `GET /api/audit-logs` (IDs + action metadata, no raw PHI). HIPAA documentation retention intent is **six years**. Automated prune is **not** enabled.

---

## Secrets

Never commit `.env`. Never paste production credentials into this repo. There is no seed-demo password in source.

| Variable | Role |
|----------|------|
| `SESSION_SECRET` | Session cookies (required) |
| `MFA_ENCRYPTION_KEY` | TOTP secrets at rest |
| `PHI_ENCRYPTION_KEY` | Patient email, phone, DOB at rest (AES-256-GCM) |
| `FORCE_HTTPS` | Optional HTTP→HTTPS redirect (`true` to enable) |
| `DATABASE_URL` | Postgres |
| `STRIPE_SECRET_KEY` | Stripe **test** secret (`sk_test_…`). Never commit live keys. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_…`) |
| `STRIPE_PRICE_ID` | Recurring Price id |
| `STRIPE_PUBLISHABLE_KEY` | Test publishable key (docs / later UI) |
| `BILLING_ENFORCE` | When `true`, block PHI writes unless status is `trialing` or `active` |
| `BILLING_REQUIRE_STRIPE` | When `true` in production, fail-fast without Stripe keys |

Production refuses to start if the required secrets are missing, weak, or placeholders. Mapping onto AWS Secrets Manager: [docs/SECRETS.md](docs/SECRETS.md).

Password-reset and invite mail is still a **stub** (log / in-memory outbox). How to attach Resend later is in [docs/WEEK3-AUTH.md](docs/WEEK3-AUTH.md).

Stripe setup, webhook forwarding (`stripe listen`), and the **no PHI in Stripe** rule: [docs/WEEK5-BILLING.md](docs/WEEK5-BILLING.md).

RDS encryption-at-rest is still required in AWS. Field-level encryption is defense in depth, not a substitute.

---

## Production cookie / TLS config

When `NODE_ENV=production`:

- `secure: true`
- `sameSite: "strict"`
- `httpOnly: true`
- 8-hour rolling session
- `trust proxy` enabled for TLS terminators (App Runner / ALB)

TLS terminates at the load balancer. The app assumes HTTPS in production. Do not set `FORCE_HTTPS=true` on App Runner unless health checks send `X-Forwarded-Proto: https`.

---

## License

UNLICENSED — private rebuild for Chiro-KPI.
