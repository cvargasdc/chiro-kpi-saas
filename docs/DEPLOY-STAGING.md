# Staging deploy checklist — Path B

**Audience:** Chris Vargas  
**As of:** 2026-09-21 (infra scaffold)

Aligned with [BAA-VENDORS.md](./BAA-VENDORS.md), [SECRETS.md](./SECRETS.md), and [infra/staging/README.md](../infra/staging/README.md). Live Replit / chiro-kpi.com is **out of scope**. This rebuild deploys to AWS when you choose to; the GitHub workflow remains a **stub**.

This checklist is scaffolding. Completing it does **not** make the app HIPAA certified.

---

## Preconditions

- [x] **AWS HIPAA BAA is Active** on the staging/production account (user-confirmed 2026-09). Re-verify in AWS Artifact before any production PHI cutover. Account IDs are not recorded in this repo.
- [ ] Private VPC; RDS **not** publicly reachable. → Terraform: `infra/staging/`
- [ ] RDS Postgres encryption at rest (KMS) + encryption in transit (require SSL). → Terraform
- [ ] Secrets Manager secrets created (`docs/SECRETS.md` names, `chirokpi/staging/…`). → Terraform seeds structure
- [ ] GitHub Actions **does not** hold production `DATABASE_URL` or dumps (GitHub is not a BAA vendor).
- [ ] No OpenAI, no ChiroTouch parsers, no Replit.
- [ ] **Synthetic data only** on first boot. No clinic PHI until encryption + backup drill are real ([BACKUPS.md](./BACKUPS.md)).

### BAA gate (infra work)

The AWS BAA gate is **satisfied for scaffolding and applying this staging stack** in the BAA account. That is necessary and **not** sufficient: app controls (tenant filters, audit, field encryption), backup drills, and workforce process remain ours. This repo is still not “HIPAA certified.”

---

## Terraform staging stack

IaC lives in [`infra/staging/`](../infra/staging/). **Preferred hosting: App Runner** (not ECS Fargate) — matches this doc’s TLS-at-edge notes, the Dockerfile comment, and the deploy workflow stub. VPC connector reaches private RDS; instance role reads Secrets Manager and writes CloudWatch. See `infra/staging/README.md` for the full why-table and apply order.

Agents / CI must **not** run `terraform apply`. You apply from an operator machine with credentials for the BAA account.

### Apply steps (summary)

1. `cd infra/staging` → copy `terraform.tfvars.example` → `terraform init` → `plan` → `apply` with `enable_apprunner=false` (VPC, KMS, RDS, secrets, ECR, IAM, logs, optional S3).
2. Confirm secret ids under `chirokpi/staging/…`. Rotate `SESSION_SECRET` / MFA / PHI keys if you prefer operator-generated values (`openssl rand -hex 32`; MFA ≠ PHI).
3. `docker build` + push to the ECR URL from `terraform output`.
4. Set `enable_apprunner=true` and `container_image`, then `plan` / `apply` again.
5. From a path that can reach **private** RDS: `DATABASE_URL` from Secrets Manager → `npm run db:push`.
6. Hit `GET /api/health`. Register two **synthetic** practices; confirm isolation. **No PHI** until backup drill.

Remote Terraform state belongs in the **same BAA account** (S3 + DynamoDB lock). Notes in `infra/staging/README.md` / `versions.tf`.

Default region in examples: `us-east-1` (change in `terraform.tfvars` if your Artifact/BAA workflow uses another HIPAA-eligible region).

---

## Container

```bash
docker build -t chiro-kpi:local .
```

- Base: Node 20 Alpine, multi-stage. Client build → `dist/public`. Process: `npx tsx server/index.ts`.
- Do not copy `.env` or `backups/` into the image (see `.dockerignore`).
- Listen on `PORT` (default 5000). Bind `0.0.0.0`.
- TLS **terminates at App Runner**. The app sets `trust proxy` in production and issues `secure` cookies. Leave `FORCE_HTTPS=false` so platform health checks that hit the container over HTTP keep working.

---

## App Runner (manual until OIDC is wired)

1. IAM roles are created by Terraform (Secrets Manager read, CloudWatch, ECR pull, VPC connector → RDS).
2. Env injection from Secrets Manager — do not paste secrets into console history if you can avoid it.
3. Health check: `GET /api/health` (public; `path: "B"`, `openai: false`).
4. Session store: Postgres `sessions` table (`connect-pg-simple`). One instance is fine; multiple instances need the shared table (already the default when `DATABASE_URL` is set).
5. Log groups: `/chirokpi/staging/app` — must not contain emails, tokens, or patient names. The redacting logger is the app-side control; still configure CloudWatch retention and access.

ECS Fargate remains a documented alternative if you later need sidecars or multi-service networking; do not dual-maintain both in Terraform without a clear cutover.

---

## GitHub workflow

`.github/workflows/deploy-staging.yml` is `workflow_dispatch` only. Confirm input must equal `deploy-staging`. AWS credential, secret-pull, image push, and App Runner deploy steps are **commented placeholders**. CI passes without AWS keys.

When you are ready:

1. Add a GitHub Environment `staging` with required reviewers.
2. Configure OIDC (`aws-actions/configure-aws-credentials`) — no long-lived access keys in GitHub if you can avoid them.
3. Uncomment the placeholder steps.
4. Keep production as a separate environment.

`.github/workflows/ci.yml` runs on PR + push to `main`: `npm ci`, `npm test`, `npm run check`, `npm run build`. It must not run `backup:db` or `terraform apply`.

---

## After first staging boot

- [ ] Register two practices (**synthetic only**); confirm isolation (`Practice A` cannot read `Practice B`).
- [ ] Confirm `GET /api/audit-logs` as owner works and as readonly returns 403.
- [ ] Confirm cookies are `Secure` + `HttpOnly` + `SameSite=strict`.
- [ ] Confirm Helmet headers (`X-Content-Type-Options`, `X-Frame-Options`, CSP, HSTS).
- [ ] Confirm patient email in the API is plaintext to the owner and ciphertext in `SELECT email FROM patients`.
- [ ] Complete an RDS restore drill and record the date ([BACKUPS.md](./BACKUPS.md)).
- [ ] Do **not** load real clinic PHI into staging until the BAA (already Active), encryption, and backup drill are real.
