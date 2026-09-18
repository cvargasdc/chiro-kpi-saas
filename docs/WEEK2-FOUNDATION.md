# Week 2 foundation — what landed

Greenfield Path B rebuild in `/workspace/chiro-kpi-saas`. Inventory: `WEEK1-BRIEFING.md`. Legacy schema was read from `/workspace/chiro-kpi-prompts/legacy-schema.ts` as reference only — not copied as-is.

Live Replit / chiro-kpi.com was **not** touched.

---

## Decisions locked in

| Topic | Decision |
|--------|----------|
| PHI posture | Path B — full ePHI from day one |
| Tenancy | `organizations` → `practices` → PHI rows; both `org_id` and `practice_id` on PHI |
| `"default"` practiceId | Banned. Columns have no such default; helpers reject it |
| Auth | Email/username + password (bcrypt). Sessions in cookies. MFA stubbed |
| AI | **No OpenAI** anywhere |
| Import | 501 stub for future generic CSV/Excel only. No ChiroTouch / SPAA / SPAT parsers |
| Secrets | `SESSION_SECRET` required from env. No seed-demo endpoint |
| Audit | `logAudit({ orgId, practiceId, actorId, action, resourceType, resourceId, metadata })`; 6-year retention intent; prune disabled |

---

## Layout

```
client/          React 18 + Vite + Tailwind + Wouter (login, register, dashboard)
server/          Express API, auth, tenant helpers, storage, audit
shared/          Drizzle schema, password policy, roles
tests/           Vitest isolation + API + policy tests
docs/            This file, threat model, BAA vendors
docker-compose.yml   Local Postgres 16
```

---

## Schema (Drizzle)

- `organizations`, `practices`
- `users` (password hash, MFA columns unused)
- `org_memberships`, `practice_memberships` — roles: `owner | admin | clinician | staff | readonly`
- PHI stubs (all require `org_id` + `practice_id`): `patients`, `patient_intakes`, `daily_stats`, `goals`, `audit_logs`
- `sessions` for `connect-pg-simple`

---

## Auth and middleware

| Middleware | Behavior |
|------------|----------|
| `authenticate` | Session `userId` → active user |
| `requireOrgAccess` | Active org membership |
| `requirePracticeMembership` | Active practice membership; sets `req.tenant` |
| `requireRole(...)` | RBAC on `req.tenant.role` |

Password policy: ≥12 characters, upper, lower, digit, special, no spaces.

Production cookies: `httpOnly`, `secure`, `SameSite=strict`, 8-hour rolling session. Login calls `session.regenerate`.

MFA: stubbed in Week 2. **Replaced in Week 3** — see [WEEK3-AUTH.md](./WEEK3-AUTH.md).

---

## Tenant isolation

Every PHI helper calls `requireTenantScope({ orgId, practiceId })`. Missing either key throws. `"default"` throws.

Patient get/list/update/delete always AND both tenant columns. Routes take tenant from the session (or `X-Practice-Id` **after** membership is proven). Client-supplied org/practice IDs cannot widen access.

### How the isolation test fails if the filter is removed

1. Open `server/storage/memory.ts` → `listPatients`.
2. Delete `&& p.practiceId === practiceId`.
3. Run `npm test`.
4. **Expected failure:** `Practice A cannot read Practice B patients` → `listPatients for Practice A does not include Practice B`.

The companion test `equivalent assertion: omitting the practice filter would leak Practice B patients` uses `listPatientsMissingPracticeFilter` (test-only, not routed) to show the other practice’s rows exist in the store. That is the control the filter is enforcing.

API-level coverage is in `tests/api-isolation.test.ts` (Practice A cannot list B; cannot fetch B’s UUID; cannot switch `X-Practice-Id` to B).

---

## Audit

```ts
await logAudit(storage, {
  orgId,
  practiceId,
  actorId,
  action,          // create | read | update | delete | list | …
  resourceType,    // "patient"
  resourceId,
  metadata,        // field names / counts — not patient names
  ipAddress,
});
```

Wired on patient create, read, update, delete, and list. `AUDIT_RETENTION_YEARS = 6`. `pruneAuditLogs()` throws so nobody “cleans up” the trail in Week 2.

---

## APIs

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | Public. `path: "B"`, `openai: false` |
| POST | `/api/auth/register` | Creates user + org + practice (owner) |
| POST | `/api/auth/login` | Email or username |
| POST | `/api/auth/logout` | |
| GET | `/api/me` | User, memberships, active practice |
| POST | `/api/session/context` | Switch active practice |
| POST | `/api/organizations` | Authenticated |
| POST | `/api/practices` | Requires org access |
| GET | `/api/practices` | Memberships only |
| CRUD | `/api/patients` | Tenant-scoped stubs |
| GET/POST | `/api/import` | **501 stub** |

---

## UI

Thin shell: sign-in, register (creates org + practice), dashboard that shows **practice name**, org, role, and a patient stub list.

---

## What is deliberately not here

- OpenAI, MCP, Grok connector
- ChiroTouch / SimplePractice parsers
- Stripe, Resend, S3
- Replit Auth, super-admin impersonation, seed-demo
- Postgres RLS (documented as next hardening)
- Automated audit prune

---

## Next foundation steps (not this week)

Week 3 landed TOTP MFA, password reset, and invites (email still a stub). Week 4 landed headers, field encryption, expanded audit, backups, and a CI/deploy spine — see [WEEK4-HARDENING.md](./WEEK4-HARDENING.md). Remaining:

1. Postgres RLS on `org_id` / `practice_id` as defense in depth
2. Resend (BAA, no PHI in mail) — adapter documented in WEEK3-AUTH.md
3. Generic CSV/Excel import with raw-row TTL
4. Expand audit to every PHI table as those APIs appear
5. Session list/revoke and a shared MFA-challenge store for multi-instance
