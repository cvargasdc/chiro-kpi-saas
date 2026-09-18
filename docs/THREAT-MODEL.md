# Threat model — Chiro-KPI Path B (Week 4)

**Audience:** Chris Vargas  
**Scope:** Greenfield Path B rebuild. Full ePHI from day one. Shared PostgreSQL, application-level tenant isolation.  
**Not in scope:** Live Replit / chiro-kpi.com, legacy OpenAI import mapping, ChiroTouch parsers.

This is a working threat model for the foundation, not a HIPAA certification artifact. Week 4 added headers/TLS posture, secrets fail-fast, field-level encryption, expanded audit, backup skeleton, and a CI/deploy spine.

---

## 1. What we are protecting

| Asset | Classification | Examples |
|--------|----------------|----------|
| Patient identity & contact | ePHI | `patients.name`, email, phone, DOB |
| Clinical / care context | ePHI | condition, intake notes, care status |
| Operational metrics linked to named patients | ePHI when joinable | daily stats + intakes |
| Workforce credentials | Sensitive (not patient PHI) | password hashes, session cookies, emails |
| Tenant graph | Sensitive | org/practice memberships, roles |
| Audit trail | ePHI-adjacent | who read/wrote which patient IDs |

Path B decision: treat patient-linked rows as ePHI even when a field looks “just a name.”

---

## 2. Trust boundaries

```
Browser  --TLS-->  Load balancer (App Runner / ALB)
                     |  HTTP to app; trust proxy = 1
                     v
                 Express (session cookie, Helmet)
                     |
                     | requireTenantScope(orgId, practiceId)
                     v
                 PostgreSQL (shared schema, row filters;
                             app-layer ciphertext on selected fields)
```

- **Inside the app process:** trusted to enforce tenant filters. A missed `WHERE practice_id = $1` is a cross-tenant incident.
- **Postgres:** trusted for at-rest encryption (RDS/KMS in AWS) but **not** yet enforcing RLS. Isolation is application-level. Patient email/phone/DOB are additionally AES-256-GCM at the app layer.
- **Subprocessors (planned):** AWS (hosting/DB/S3/Secrets Manager), Stripe (billing), Resend (email). **OpenAI is out.** GitHub Actions is CI only and must not receive ePHI.
- **Operators / break-glass:** not implemented. Impersonation from the legacy app is intentionally omitted.

---

## 3. Actors

| Actor | Trust | Notes |
|--------|--------|--------|
| Practice owner / admin | Tenant-scoped | Can create practices in their org, mutate PHI |
| Clinician / staff | Tenant-scoped | PHI read/write; cannot delete in Week 2 |
| Readonly member | Tenant-scoped | PHI read only |
| Unauthenticated internet | Untrusted | Health endpoint only |
| Platform operator | High | No super-admin impersonation in this foundation |
| Subprocessor staff | Contractual (BAA) | AWS/Stripe/Resend only |

---

## 4. Key threats and Week 2–4 controls

| ID | Threat | Impact | Control now | Residual / later |
|----|--------|--------|-------------|------------------|
| T1 | Cross-tenant PHI read (Practice A reads B) | High — HIPAA incident | PHI helpers require `orgId` + `practiceId`; no `"default"` practiceId; membership middleware; automated isolation tests | Postgres RLS; query linter |
| T2 | IDOR by patient UUID | High | `getPatient` always ANDs tenant keys; unknown IDs return 404 | Same |
| T3 | Client-supplied tenant IDs | High | Writes take tenant from session/membership, not from body | Bind tenant in DB session vars |
| T4 | Weak passwords / stolen creds | High | ≥12 chars + complexity; bcrypt; 8h rolling httpOnly cookies; secure + SameSite=strict in production; TOTP MFA + hashed recovery codes; hashed password-reset tokens | Breach-password check, lockout, WebAuthn |
| T5 | Session fixation / cookie theft | High | `session.regenerate` on login; httpOnly; production `secure` + SameSite=strict; Helmet; `trust proxy` for TLS terminators | CSRF tokens if cookie SameSite ever loosens |
| T6 | Missing audit of PHI access | Medium | `logAudit` on patient CRUD/list **and** auth (login success/failure, logout, MFA, password reset), invites, org/practice create; 6-year retention intent; prune disabled; `GET /api/audit-logs` owner\|admin, tenant-scoped, paginated, IDs + action metadata only (no raw PHI) | Hash-chain / WORM; cover exports; unauthenticated unknown-user login failures still have no tenant to attach to |
| T7 | Secrets in repo / seed-demo | High | No hardcoded session secrets; no seed-demo endpoint; production fail-fast for missing/weak `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `PHI_ENCRYPTION_KEY`, `DATABASE_URL`; Secrets Manager name map in `docs/SECRETS.md` | Wire App Runner injection; dual-key rotation |
| T8 | Outbound PHI to AI | High | No OpenAI client, no MCP, no import AI | Keep out of v1 |
| T9 | Import raw EHR dumps | High | Import is a 501 stub; no ChiroTouch parsers | Generic CSV/Excel later with TTL on raw rows |
| T10 | Log leakage of names/emails | Medium | Redacting logger (`server/log/redact.ts`) strips secret/PHI keys; mailer logs template + subject only; audit API omits IPs and PHI; metadata stores field names not values | APM redaction if an APM is added (BAA first) |
| T11 | Unauthenticated object storage | High (legacy) | No upload/object routes in Week 2 | Auth + practice ACL before S3 |
| T12 | RBAC bypass | Medium | `requireRole` on patient writes/deletes | Fine-grained permission matrix |
| T13 | Shared-DB noisy neighbor / backup restore mixup | Medium | Single DB documented; `scripts/backup-db.sh` + restore drill notes; `CONFIRM=YES` on restore; dumps gitignored; CI must not upload backups | Per-env accounts; scheduled restore drills; RDS snapshots in the BAA account |

---

## 5. Abuse cases the tests cover

1. Practice A lists patients → empty of Practice B rows.
2. Practice A fetches Practice B’s patient id → 404.
3. Practice A sends `X-Practice-Id` of B → 403.
4. Calling PHI helpers without `practiceId` throws (no silent default).
5. A deliberately unscoped helper *would* return the other practice’s patients — proving the filter is the control.

If someone removes the `practiceId` predicate from `listPatients`, `tests/isolation.test.ts` fails. See `docs/WEEK2-FOUNDATION.md`.

---

## 6. Explicit non-goals this week

- Postgres RLS policies
- Live email, Stripe, S3
- Super-admin / impersonation
- CSRF tokens (SameSite cookies only)
- Automated encryption-key rotation
- Real App Runner cutover (workflow is a stub)

Week 3 landed TOTP MFA. Week 4 landed app-layer field encryption for patient email/phone/DOB **in addition to** RDS encryption-at-rest (still required).

---

## 7. Incident notes

Cross-tenant reads are **reportable** if they expose ePHI. The audit log is the evidence trail; do not prune it. Retention intent is **6 years** (HIPAA §164.530(j)).
