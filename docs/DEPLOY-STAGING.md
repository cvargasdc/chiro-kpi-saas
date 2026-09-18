# Staging deploy checklist — Path B

**Audience:** Chris Vargas  
**As of:** Week 4 (2026-09-18)

Aligned with [BAA-VENDORS.md](./BAA-VENDORS.md) and [SECRETS.md](./SECRETS.md). Live Replit / chiro-kpi.com is **out of scope**. This rebuild deploys to AWS when you choose to; the GitHub workflow is a **stub**.

This checklist is scaffolding. Completing it does not make the app HIPAA certified.

---

## Preconditions

- [ ] AWS account that can sign (or already signed) the AWS HIPAA BAA via Artifact.
- [ ] Private VPC; RDS **not** publicly reachable.
- [ ] RDS Postgres encryption at rest (KMS) + encryption in transit (require SSL).
- [ ] Secrets Manager secrets created (`docs/SECRETS.md` names).
- [ ] GitHub Actions **does not** hold production `DATABASE_URL` or dumps (GitHub is not a BAA vendor).
- [ ] No OpenAI, no ChiroTouch parsers, no Replit.

---

## Container

```bash
docker build -t chiro-kpi:local .
```

- Base: Node 20 Alpine, multi-stage. Client build → `dist/public`. Process: `npx tsx server/index.ts`.
- Do not copy `.env` or `backups/` into the image (see `.dockerignore`).
- Listen on `PORT` (default 5000). Bind `0.0.0.0`.
- TLS **terminates at App Runner / ALB**. The app sets `trust proxy` in production and issues `secure` cookies. Leave `FORCE_HTTPS=false` so platform health checks that hit the container over HTTP keep working.

---

## App Runner / ECS (manual until OIDC is wired)

1. Create an IAM role for the service (read Secrets Manager, write CloudWatch, connect to RDS).
2. Inject env from Secrets Manager — do not paste secrets into the console history if you can avoid it.
3. Health check: `GET /api/health` (public; `path: "B"`, `openai: false`).
4. Session store: Postgres `sessions` table (`connect-pg-simple`). One instance is fine; multiple instances need the shared table (already the default when `DATABASE_URL` is set).
5. Log groups: application logs must not contain emails, tokens, or patient names. The redacting logger is the app-side control; still configure CloudWatch retention and access.

---

## GitHub workflow

`.github/workflows/deploy-staging.yml` is `workflow_dispatch` only. Confirm input must equal `deploy-staging`. AWS credential, secret-pull, image push, and App Runner deploy steps are **commented placeholders**. CI passes without AWS keys.

When you are ready:

1. Add a GitHub Environment `staging` with required reviewers.
2. Configure OIDC (`aws-actions/configure-aws-credentials`) — no long-lived access keys in GitHub if you can avoid them.
3. Uncomment the placeholder steps.
4. Keep production as a separate environment.

`.github/workflows/ci.yml` runs on PR + push to `main`: `npm ci`, `npm test`, `npm run check`, `npm run build`. It must not run `backup:db`.

---

## After first staging boot

- [ ] Register two practices; confirm isolation (`Practice A` cannot read `Practice B`).
- [ ] Confirm `GET /api/audit-logs` as owner works and as readonly returns 403.
- [ ] Confirm cookies are `Secure` + `HttpOnly` + `SameSite=strict`.
- [ ] Confirm Helmet headers (`X-Content-Type-Options`, `X-Frame-Options`, CSP, HSTS).
- [ ] Confirm patient email in the API is plaintext to the owner and ciphertext in `SELECT email FROM patients`.
- [ ] Do **not** load real clinic PHI into staging until the BAA, encryption, and backup drill are real.
