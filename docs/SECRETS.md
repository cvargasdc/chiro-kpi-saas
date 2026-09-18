# Secrets mapping — Path B

**Audience:** Chris Vargas  
**As of:** Week 4 hardening (2026-09-18)

No secrets belong in git. `.env` is gitignored. `.env.example` lists **placeholder names only**.

This is not a HIPAA certification artifact. It is the wiring map for App Runner / ECS so production does not start on weak or missing keys.

---

## Fail-fast (production)

`server/config.ts` refuses to boot in `NODE_ENV=production` when any of these are missing, shorter than 32 characters, or look like placeholders (`replace-with…`, `changeme`, `test-…`):

| Env var | Purpose |
|---------|---------|
| `SESSION_SECRET` | Signed session cookies |
| `MFA_ENCRYPTION_KEY` | AES-256-GCM for TOTP secrets |
| `PHI_ENCRYPTION_KEY` | AES-256-GCM for patient email / phone / DOB (**must differ from MFA key**) |
| `DATABASE_URL` | Postgres. Local docker default `chirokpi_local` is rejected in production |

Development still requires `SESSION_SECRET` and the two encryption keys (32+). `DATABASE_URL` is required to actually listen (`server/index.ts`).

---

## Env var → AWS Secrets Manager

Suggested secret ids. Create them in the **HIPAA-eligible** AWS account that signed the BAA, after encryption at rest (KMS) is on.

| Env var | Secrets Manager secret id |
|---------|---------------------------|
| `SESSION_SECRET` | `chirokpi/prod/SESSION_SECRET` |
| `MFA_ENCRYPTION_KEY` | `chirokpi/prod/MFA_ENCRYPTION_KEY` |
| `PHI_ENCRYPTION_KEY` | `chirokpi/prod/PHI_ENCRYPTION_KEY` |
| `DATABASE_URL` | `chirokpi/prod/DATABASE_URL` |
| `RESEND_API_KEY` | `chirokpi/prod/RESEND_API_KEY` (unused until mail is wired) |

Staging can use the `chirokpi/staging/…` prefix.

**Preferred deploy path:** App Runner / ECS injects these as environment variables from Secrets Manager. The process then reads `process.env` (`EnvSecretsProvider`). No AWS API call at request time.

**Optional in-process fetch:** `server/secrets/` is a thin interface:

- `EnvSecretsProvider` — local and injected env
- `NoopSecretsProvider` — tests
- `AwsSecretsManagerProvider` — **does not call AWS** unless credentials exist **and** a client is injected. This repo does not depend on `@aws-sdk/client-secrets-manager`.

Do not log `SecretString`. The redacting logger (`server/log/redact.ts`) strips keys matching secret / token / password / PHI field names. Prefer IDs (`userId`, `orgId`, `practiceId`, `resourceId`) in log metadata.

---

## Rotation notes

1. Generate with `openssl rand -hex 32` (or stronger).
2. Rotate `SESSION_SECRET` → all sessions die (users sign in again).
3. Rotate `MFA_ENCRYPTION_KEY` only with a decrypt-old/encrypt-new dual-key window — not implemented. Treat as break-glass.
4. Rotate `PHI_ENCRYPTION_KEY` the same way — dual-key rewrite of `patients.email|phone|date_of_birth` is not automated in Week 4.
5. Never reuse the MFA key as the PHI key.

---

## GitHub Actions

CI (`npm test`, `tsc`, `vite build`) must **not** receive production secrets or database dumps. GitHub is not a BAA vendor. See `docs/BAA-VENDORS.md` and `.github/workflows/ci.yml`.
