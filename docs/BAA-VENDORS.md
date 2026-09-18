# Business Associate / subprocessor inventory — Path B

**Audience:** Chris Vargas  
**As of:** Week 4 hardening (2026-09-18)

Path B treats patient names, contact, DOB, condition, intake notes, and related operational rows as ePHI. Every vendor that can touch that data (or the systems that store it) needs a BAA **before** production PHI lands there.

This list is the **rebuild** inventory. The live Replit app is out of scope here.

---

## In for v1 (need BAAs before production PHI)

| Vendor | Use | Touches ePHI? | BAA | Week 2 status |
|--------|-----|---------------|-----|----------------|
| **AWS** | App hosting (e.g. App Runner), RDS PostgreSQL, S3 (later), Secrets Manager, CloudWatch, RDS snapshots | Yes — primary store and backups | AWS HIPAA BAA (Artifact). Signing the BAA does **not** make the app compliant by itself. | Not deployed from this repo. Use private RDS, encryption at rest (KMS), TLS in transit, no public DB. App-layer AES-256-GCM on selected patient fields is extra, not a substitute. Secrets Manager name map: `docs/SECRETS.md`. |
| **Stripe** | Subscription billing | Generally **no patient PHI**. May hold org/practice billing identity (workforce). Keep PHI out of Stripe metadata. | Stripe HIPAA support is limited; treat as **no PHI in Stripe**. BAA only if a future flow sends patient-linked data (do not). | Not wired. |
| **Resend** | Transactional email (password reset, invites, digests) | Workforce email. Digests must **not** include patient names. | Execute a BAA if any email could include ePHI. Safer: never put patient identifiers in email. | Interface + `ResendMailer` stub in Week 3. Runtime uses `LoggingMailer` / tests use `InMemoryMailer`. See `docs/WEEK3-AUTH.md`. |

Reference: Week 1 reviewed `/workspace/chiro-kpi-reference/AWS-Business-Associate-Addendum.pdf` (read-only). Re-verify the signed AWS BAA in Artifact before any production cutover.

---

## Explicitly OUT of v1

| Vendor | Why it was in the legacy app | Path B decision |
|--------|------------------------------|-----------------|
| **OpenAI** | Import column mapping with sample-cell masking | **Do not integrate.** No SDK, no API keys, no masked samples outbound. Removes an AI subprocessor and a PHI-exfiltration path. |
| ChiroTouch (as a data source / parser) | EOD report parsers | **Do not port.** Generic CSV/Excel import may come later; CT-specific formats are out. |
| Replit (hosting / Auth / object storage) | Current production | **Do not touch.** This rebuild is a separate tree. |

---

## Later candidates (not this week)

| Vendor | Possible use | BAA needed if… |
|--------|----------------|----------------|
| Email DNS / mailbox provider | Inbound support | Staff paste PHI into tickets |
| Error tracking / APM | Ops | Stack traces or breadcrumbs include names — **forbid** |
| Browser analytics | Product | Default off for authenticated PHI screens |
| MCP / Grok connector | Legacy Settings → MCP key | Out until a dedicated design; query-string API keys are banned |
| **GitHub Actions** | CI (`npm test` / `tsc` / `vite build`) and a **stub** staging deploy | **No.** GitHub is not a BAA vendor. CI must not receive production `DATABASE_URL`, dumps, or patient data. No backup artifacts. |

---

## Rules of engagement

1. **No new subprocessor** without updating this file and confirming BAA status.
2. **No PHI in billing, email, or logs.** IDs only.
3. **No OpenAI** — not even “just for mapping headers.”
4. Credentials live in environment / Secrets Manager, never in git.
5. A signed AWS BAA is necessary and not sufficient. App controls (tenant filters, audit, access) remain ours.
