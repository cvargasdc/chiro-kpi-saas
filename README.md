# Chiro-KPI (Path B rebuild)

Multi-tenant practice KPI software for chiropractic clinics. This tree is a **greenfield rebuild**, not a copy of the live Replit app.

**Path B:** treat patient identity, contact, clinical notes, and joinable operational rows as **ePHI from day one**.

Week 3 hardens auth (password reset, practice invites, TOTP MFA, RBAC on writes) on the Week 2 foundation. It does **not** replace chiro-kpi.com.

---

## For Chris Vargas — what this is

| In v1 / this foundation | Out (do not expect them here) |
|-------------------------|--------------------------------|
| Organizations → practices → memberships | Replit Auth / impersonation |
| Full PHI posture + audit log skeleton | OpenAI (no client, no mapping) |
| Email/username + password, bcrypt, session cookies, TOTP MFA | ChiroTouch EOD parsers |
| RBAC: owner, admin, clinician, staff, readonly | SimplePractice-specific import |
| Password reset + practice invites (email stub) | Stripe / live Resend (adapter documented) |
| Patient CRUD stubs, isolated by practice | S3 / Daily Log / Dashboard product |
| CSV/Excel import **placeholder only** | Hardcoded demo secrets |
| Local Docker Postgres | Any deploy to Replit or production |

Read next:

- [docs/WEEK3-AUTH.md](docs/WEEK3-AUTH.md) — password reset, invites, TOTP MFA
- [docs/WEEK2-FOUNDATION.md](docs/WEEK2-FOUNDATION.md) — schema, isolation, audit skeleton
- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) — threats and controls
- [docs/BAA-VENDORS.md](docs/BAA-VENDORS.md) — AWS, Stripe, Resend in; **OpenAI out**
- [WEEK1-BRIEFING.md](WEEK1-BRIEFING.md) — inventory of the legacy app

---

## Stack

TypeScript, React 18, Vite, Express, Drizzle ORM, PostgreSQL, Tailwind. Tests: Vitest.

---

## Run locally

You need Node 20+ and Docker (for Postgres).

```bash
cp .env.example .env
# Set SESSION_SECRET and MFA_ENCRYPTION_KEY to long random values, e.g.:
#   openssl rand -hex 32

docker compose up -d
npm install
npx drizzle-kit push
npm run dev
```

Open [http://localhost:5000](http://localhost:5000). Register a user — that creates an organization and a practice. The dashboard shows the practice name.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm test` | Isolation, auth (reset/invite/MFA/RBAC), audit, schema tests |
| `npm run check` | TypeScript |
| `npm run build` | Production client bundle → `dist/public` |
| `npm run db:push` | Push Drizzle schema to local Postgres |

`npm test` does **not** need Postgres. It uses an in-memory store.

---

## Tenant isolation (the non-negotiable)

PHI helpers refuse to run without both `orgId` and `practiceId`. There is no `"default"` practice.

Automated tests assert **Practice A cannot read Practice B patients**, including by UUID and by spoofed `X-Practice-Id`.

To see the test fail when the filter is removed: delete the `practiceId` predicate in `MemoryStorage.listPatients` and re-run `npm test`. Details in [docs/WEEK2-FOUNDATION.md](docs/WEEK2-FOUNDATION.md).

---

## Audit retention

`logAudit(...)` is wired into patient create / read / update / delete / list. HIPAA documentation retention intent is **six years**. Automated prune is **not** enabled.

---

## Secrets

Never commit `.env`. Never paste production credentials into this repo. There is no seed-demo password in source.

`MFA_ENCRYPTION_KEY` encrypts TOTP secrets at rest. Password-reset and invite mail is a **stub** in Week 3 (log / in-memory outbox). How to attach Resend later is in [docs/WEEK3-AUTH.md](docs/WEEK3-AUTH.md).

---

## Production cookie config

When `NODE_ENV=production`:

- `secure: true`
- `sameSite: "strict"`
- `httpOnly: true`
- 8-hour rolling session
- `trust proxy` enabled for TLS terminators

---

## License

UNLICENSED — private rebuild for Chiro-KPI.
