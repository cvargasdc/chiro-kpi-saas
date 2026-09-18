# Week 4 — Encryption, audit expansion, backups, CI/deploy spine

Path B isolation (`org_id` + `practice_id` on PHI) is unchanged. No OpenAI. No ChiroTouch parsers. Live Replit / chiro-kpi.com was not touched.

This is pragmatic scaffolding — not a claim that the product is HIPAA certified.

---

## What landed

| Area | Behavior |
|------|----------|
| Security headers | Helmet on Express. `X-Powered-By` off. Production CSP + HSTS. |
| TLS posture | TLS terminates at the load balancer. Production sets `trust proxy` (1 hop) and `secure` cookies. `FORCE_HTTPS=true` optionally redirects HTTP→HTTPS; leave it **off** on App Runner so health checks still work. |
| Secrets | `loadConfig` fail-fast in production for `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `PHI_ENCRYPTION_KEY`, `DATABASE_URL`. Mapping in [SECRETS.md](./SECRETS.md). Thin Secrets Manager interface; no AWS calls without credentials + injected client. |
| Logs | `server/log/redact.ts` strips secret/PHI keys. Mailer logs template + subject only. Audit failure logs IDs only. |
| Field encryption | AES-256-GCM (`PHI_ENCRYPTION_KEY`, distinct from MFA) on `patients.email`, `patients.phone`, `patients.dateOfBirth`. Ciphertext in the store; plaintext on storage-layer read. `date_of_birth` is **text** so the envelope fits. RDS encryption-at-rest is still required. |
| Audit | Login success/failure (no password), logout, MFA enroll/verify/disable, password reset request/complete, invite create/accept/revoke, org/practice create. `GET /api/audit-logs` owner\|admin, tenant-scoped, paginated, no raw PHI. |
| Backups | `npm run backup:db` → `scripts/backup-db.sh`. No-ops if `pg_dump` or `DATABASE_URL` is missing. `backups/` gitignored. Restore drill in [BACKUPS.md](./BACKUPS.md). |
| CI / deploy | `.github/workflows/ci.yml` (PR + main: test, tsc, build). Staging deploy workflow is `workflow_dispatch` only with commented AWS steps. `Dockerfile` (Node 20, multi-stage). Checklist: [DEPLOY-STAGING.md](./DEPLOY-STAGING.md). |

---

## How to run backups

```bash
cp .env.example .env
docker compose up -d
npm run backup:db
```

If client tools are missing, the script prints a `docker compose exec … pg_dump` example and exits 0. Dumps are ePHI — never commit them, never upload them from CI.

Restore (drill database only):

```bash
CONFIRM=YES DATABASE_URL=postgres://… ./scripts/restore-db.sh backups/chirokpi-YYYYMMDDTHHMMSSZ.sql
```

---

## CI status

- **CI:** install → `npm test` → `npm run check` → `npm run build` on pull requests and pushes to `main`.
- **Staging deploy:** stub. Requires `workflow_dispatch` confirm string `deploy-staging`. Does not need AWS credentials to pass.
- GitHub must not receive production PHI. See [BAA-VENDORS.md](./BAA-VENDORS.md).

---

## New environment variables

```
PHI_ENCRYPTION_KEY=    # 32+ chars; openssl rand -hex 32; not the MFA key
FORCE_HTTPS=false      # optional HTTP→HTTPS redirect
# TRUST_PROXY=true     # optional; production already trusts the first proxy
```

Existing: `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `DATABASE_URL`, `APP_BASE_URL`.

---

## Existing plaintext (memory tests / pre-Week-4 rows)

Decrypt treats values **without** a `v1:` prefix as legacy plaintext and returns them as-is. The next write encrypts. In-memory tests seed ciphertext when `PHI_ENCRYPTION_KEY` is set (Vitest injects a test key). A one-shot rewrite job is not included; run `drizzle-kit push` after pulling so `date_of_birth` is `text`.

---

## Isolation

Patient helpers still require both tenant keys. Isolation tests still fail if the practice filter is removed. Field encryption does not change the `WHERE org_id AND practice_id` control.

---

## Out of this week

- Daily Log / Dashboard product features
- Postgres RLS
- Live Resend / S3. Stripe test-mode landed in [WEEK5-BILLING.md](./WEEK5-BILLING.md).
- Automated PHI key rotation
- Real App Runner deploy
