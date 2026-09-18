# Threat model — Chiro-KPI Path B (Week 2)

**Audience:** Chris Vargas  
**Scope:** Greenfield Path B rebuild. Full ePHI from day one. Shared PostgreSQL, application-level tenant isolation.  
**Not in scope:** Live Replit / chiro-kpi.com, legacy OpenAI import mapping, ChiroTouch parsers.

This is a working threat model for the foundation, not a HIPAA certification artifact.

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
Browser  --TLS-->  Express (session cookie)
                     |
                     | requireTenantScope(orgId, practiceId)
                     v
                 PostgreSQL (shared schema, row filters)
```

- **Inside the app process:** trusted to enforce tenant filters. A missed `WHERE practice_id = $1` is a cross-tenant incident.
- **Postgres:** trusted for at-rest encryption (RDS/KMS later) but **not** yet enforcing RLS. Week 2 isolation is application-level.
- **Subprocessors (planned):** AWS (hosting/DB/S3), Stripe (billing), Resend (email). **OpenAI is out.**
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

## 4. Key threats and Week 2 controls

| ID | Threat | Impact | Control now | Residual / later |
|----|--------|--------|-------------|------------------|
| T1 | Cross-tenant PHI read (Practice A reads B) | High — HIPAA incident | PHI helpers require `orgId` + `practiceId`; no `"default"` practiceId; membership middleware; automated isolation tests | Postgres RLS; query linter |
| T2 | IDOR by patient UUID | High | `getPatient` always ANDs tenant keys; unknown IDs return 404 | Same |
| T3 | Client-supplied tenant IDs | High | Writes take tenant from session/membership, not from body | Bind tenant in DB session vars |
| T4 | Weak passwords / stolen creds | High | ≥12 chars + complexity; bcrypt; 8h rolling httpOnly cookies; secure + SameSite=strict in production; TOTP MFA + hashed recovery codes; hashed password-reset tokens | Breach-password check, lockout, WebAuthn |
| T5 | Session fixation / cookie theft | High | `session.regenerate` on login; httpOnly; production `secure` | CSRF tokens if cookie SameSite ever loosens |
| T6 | Missing audit of PHI access | Medium | `logAudit` on patient create/read/update/delete/list; 6-year retention intent; prune disabled | Hash-chain / WORM; cover exports |
| T7 | Secrets in repo / seed-demo | High | No hardcoded session secrets; no seed-demo endpoint | Secrets Manager in AWS deploy |
| T8 | Outbound PHI to AI | High | No OpenAI client, no MCP, no import AI | Keep out of v1 |
| T9 | Import raw EHR dumps | High | Import is a 501 stub; no ChiroTouch parsers | Generic CSV/Excel later with TTL on raw rows |
| T10 | Log leakage of names/emails | Medium | Request logs should use IDs only; audit metadata stores field names not values | APM redaction |
| T11 | Unauthenticated object storage | High (legacy) | No upload/object routes in Week 2 | Auth + practice ACL before S3 |
| T12 | RBAC bypass | Medium | `requireRole` on patient writes/deletes | Fine-grained permission matrix |
| T13 | Shared-DB noisy neighbor / backup restore mixup | Medium | Single DB documented | Per-env accounts; restore drills |

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
- MFA enrollment (columns + functions are stubs)
- Email, Stripe, S3
- Super-admin / impersonation
- CSRF tokens (SameSite cookies only)
- Field-level encryption (relies on disk encryption later)

---

## 7. Incident notes

Cross-tenant reads are **reportable** if they expose ePHI. The audit log is the evidence trail; do not prune it. Retention intent is **6 years** (HIPAA §164.530(j)).
