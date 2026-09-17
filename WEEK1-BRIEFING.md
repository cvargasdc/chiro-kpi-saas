# Chiro-KPI Week 1 Briefing — Architecture, PHI Inventory & Foundation Risks

**Audience:** Chris Vargas (review)  
**Source:** Read-only unzip of `/home/box/Downloads/Chiro-KPI.zip` → `/workspace/chiro-kpi-source/`  
**Also reviewed:** `/workspace/chiro-kpi-reference/AWS-Business-Associate-Addendum.pdf`  
**Scope:** Inventory only — no live Replit changes, no prod DB, no deploy, no rewrite.

---

## 1. Stack summary

| Layer | Choice |
|--------|--------|
| Frontend | React 18 + TypeScript, Vite, Wouter routing, TanStack Query, Shadcn/Radix, Tailwind, Recharts |
| Backend | Express 4 + TypeScript (`tsx` / `esbuild` bundle), single `server/routes.ts` (~5.2k LOC) |
| ORM / DB | Drizzle ORM + PostgreSQL (`pg` Pool via `DATABASE_URL`) |
| Schema | `shared/schema.ts` + `shared/models/auth.ts` (sessions/users) + `shared/models/chat.ts` |
| Auth | Dual: (1) Replit OAuth / Passport, (2) local username+password (`bcryptjs`) in `local_users`; Express sessions (`connect-pg-simple` / `sessions` table) |
| Tenancy today | **Practice-scoped multi-tenant** via `practiceId` on business tables (not `org_id`) |
| Object storage | AWS S3 (`@aws-sdk/client-s3`, presigned PUT, proxy `GET /objects/*`) |
| Billing | Stripe (webhook + checkout/portal) |
| Email | Resend (password reset, invites, digests, welcome) |
| AI | OpenAI for import column mapping (with sample-cell masking); MCP JSON-RPC at `/api/mcp` for Grok connector |
| Deploy docs | `aws-deployment-guide.md` → App Runner + RDS + S3 + Secrets Manager; HIPAA-eligible services under AWS BAA |
| Container | `Dockerfile.eb` — Node 20 slim, runs `dist/index.cjs` |

**Top-level layout (extracted, bulky paths excluded):**

```
client/          # React app (pages, components, hooks)
server/          # Express API, storage, parsers, integrations
shared/          # Drizzle schema + shared types
scripts/, script/
attached_assets/ # (videos excluded from extract)
aws-deployment-guide.md, package.json, drizzle.config.ts, …
```

Excluded from extract to save space: `.git/` (~118MB), `dist/`, `.canvas/` video, `.config/`, `attached_assets/generated_videos/*.mp4`. No `node_modules` was present in the zip.

---

## 2. Module map (matches live app areas)

| Live UI area | Client route / page | Primary API / tables |
|--------------|---------------------|----------------------|
| Dashboard | `/`, `/dashboard` → `dashboard.tsx` | `GET /api/dashboard`; KPIs from intakes + daily_appointments + revenue |
| Patients | `/patients` → `patients.tsx` + `patients-table`, `new-patients-panel` | `patients`, `patient_intakes`, checklist progress |
| Daily Log | `/daily-log` | `daily_appointments`, `revenue` (side-by-side by date) |
| Appointments (legacy) | `/appointments` | `appointments` (individual rows; product notes say EHR owns scheduling — counts matter most) |
| Revenue (legacy) | `/revenue` | `revenue` |
| Goals | `/goals` | `goals` |
| Providers | `/providers` | `providers` + per-provider stats |
| Care Plan Generator | `/care-plan-calculator` | `care_plans`, `care_plan_templates`, `treatments` |
| Services / Treatments | `/treatments` | `treatments` |
| Reports | `/reports` | Aggregates + client PDF (`jspdf`) |
| Data Import | `/import` (super-admin gated in UI) | `import_batches`, `import_rows`, ChiroTouch/SPAA/SPAT parsers; OpenAI mapping |
| Practice Checklists | `/practice-checklists` | `practice_checklists`, items, completions |
| Patient Onboarding | `/checklists`, `/checklists/:id` | `checklist_templates`, `patient_checklists`, tasks |
| Projects | `/projects`, `/projects/:id` | `projects`, `project_columns`, `project_tasks` |
| Settings | `/settings` | `practices`, `practice_settings`, staff, invites, GHL, MCP key |
| Platform Admin | `/admin` | Super-admin practices/users/billing/feedback/**HIPAA audit log** UI |
| Advanced Metrics | `/advanced-metrics` (super-admin) | `advanced_metrics_inputs` |
| Auth / onboarding | landing, register, setup, forgot/reset password, accept-invite | `local_users`, `password_reset_tokens`, `team_invitations` |
| MCP / Grok connector | Settings → generate MCP key; `/api/mcp` | Tools: KPIs, intakes, goals, daily log, providers, projects, patient checklists |

**Auth / access model (current):**

- Session carries `localUser` (`id`, `username`, `practiceId`, `role`, `displayName`, `superAdmin`) or Replit claims.
- `isAuthenticated` → local session **or** Replit auth.
- `requirePractice` → sets `req.practiceId` from local user, or auto-creates a practice for Replit owner.
- `requireSuperAdmin` → `local_users.super_admin` or `replit_super_admins`.
- Impersonation: super-admin can session-swap into a practice owner.
- `role` on users exists (`staff` default) but **most API routes do not enforce role-based RBAC** beyond practice membership + super-admin.

---

## 3. Architecture notes (client vs server, schema, S3)

### Client vs server

- **Monorepo-style single app:** Vite serves client in dev; production serves static + API from one Node process.
- **Almost all HTTP surface** lives in `server/routes.ts`; persistence in `server/storage.ts` (DatabaseStorage) with `practiceId` arguments on CRUD.
- **Parsers / side services:** `chirotouch-parser`, `spaa-parser`, `spat-parser`, `import-service`, `import-ai-service`, `email`, `digest`, `stripeClient`.

### Multi-tenant assumptions

- **Already multi-practice SaaS**, not single-practice-only.
- Tenant key = **`practiceId`** (varchar UUID). No `organizations` / `org_id` table.
- Shared PostgreSQL database; isolation is **application-level row filtering**, not schema-per-tenant or Postgres RLS.
- Many older columns default `practiceId` to `"default"` in schema definitions (risk if any code path omits practice scoping).
- Chat tables (`conversations`, `messages`) have **no `practiceId`**.

### S3 usage

- Env: `S3_BUCKET_NAME`, `S3_REGION` / `AWS_REGION`, optional `S3_UPLOAD_PREFIX` (default `uploads`).
- Flow: `POST /api/uploads/request-url` → presigned PUT → store `/objects/...` path (e.g. practice logos).
- Serve: `GET /objects/*` proxies from S3.
- ACL metadata stored as S3 object metadata (`aclpolicy`) with `public|private` visibility.
- **Gap:** upload URL route and object download route appear **unauthenticated** in code (no `isAuthenticated` / practice ownership check on those handlers).

### AWS BAA

- Operational guidance in-repo (`aws-deployment-guide.md`): Artifact BAA, private RDS, VPC connector, SSE on S3, private bucket + app proxy.
- Reference PDF present under `/workspace/chiro-kpi-reference/`. Signing BAA ≠ application HIPAA compliance; app controls still required.

---

## 4. Full PHI field inventory (Path B — treat as full PHI from day one)

Legend: **Yes** = clearly PHI / ePHI or identifiers when linked to care; **Maybe** = can become PHI in context or free-text; **No** = generally not PHI alone.

| Table / collection | Field | Likely PHI? | Reason | Where it appears in UI (if obvious) |
|--------------------|-------|-------------|--------|-------------------------------------|
| **patients** | name | **Yes** | Patient identifier | Patients table / dashboard recent patients |
| patients | email | **Yes** | Contact identifier | Patients table edit/view |
| patients | phone | **Yes** | Contact identifier | Patients table edit/view |
| patients | dateOfBirth | **Yes** | Demographic identifier | Schema only (little/no UI found) |
| patients | condition | **Yes** | Health information | Patients table |
| patients | status | Maybe | Care-related status | Patients table |
| patients | practiceId / id | No* | Tenant/system IDs (*linkable) | Internal |
| **patient_intakes** | name | **Yes** | Patient name | Patients, New Patients panel, Daily Log flows, MCP |
| patient_intakes | typeName / category | Maybe | Care classification | Patients filters (New/Wellness) |
| patient_intakes | day1Date / day2Date | Maybe | Visit dates linked to named patient | Intake UI |
| patient_intakes | careStatus / converted / conversionDate / planType | Maybe | Treatment/plan outcome | Conversion toggles |
| patient_intakes | notes | **Yes** | Free-text clinical/admin notes | Intake notes |
| patient_intakes | providerId | Maybe | Links named patient to provider | Providers / intake forms |
| **appointments** | patientName | **Yes** | Patient identifier | Appointments page |
| appointments | patientId | Maybe | Link to patient | Internal |
| appointments | date / time / type / status | Maybe | Encounter metadata | Appointments |
| appointments | notes | **Yes** | Free-text | Appointments |
| **revenue** | patientId | Maybe | Links payment to patient | Revenue / Daily Log |
| revenue | amount / paymentMethod / description | Maybe | Financial + possible identifiers in description | Revenue / Daily Log |
| **care_plans** | firstName / lastName | **Yes** | Patient name | Care Plan Calculator + PDF |
| care_plans | treatmentSelections / paymentSettings | Maybe | Treatment + payment terms for named patient | Calculator / PDF |
| care_plans | notes | **Yes** | Free-text on plan | Calculator / PDF |
| care_plans | subtotal | Maybe | Individual financial | Calculator |
| **patient_checklists** | patientIntakeId / templateName / notes | **Yes**/Maybe | Tied to named patient; notes free-text | Onboarding / checklist pages; MCP |
| **patient_checklist_tasks** | title / description / notes / assigneeName | Maybe | Task text may describe patient care | Checklist detail |
| **import_batches** | fileName | Maybe | May contain patient/clinic identifiers | Import UI |
| **import_rows** | rawData | **Yes** | Full EHR export row JSON/text | Import pipeline (stored) |
| import_rows | normalizedData | **Yes** | Mapped fields often include names | Import pipeline |
| **audit_logs** | resourceName / details / username / ipAddress | **Yes**/Maybe | Stores intake names in resourceName; search queries in details | Admin → HIPAA Audit Log |
| **notifications** | title / message | Maybe | May include patient/task context | Sidebar bell |
| **digest_user_logs** | email | Maybe | Workforce email (not patient) | Admin digest logs |
| **local_users** | email / username / displayName / passwordHash | Maybe | Workforce credentials/PII (not patient PHI) | Settings staff; login |
| **team_invitations** | email / displayName | Maybe | Workforce | Settings invites |
| **users** (Replit) | email / firstName / lastName / profileImageUrl | Maybe | Workforce | Auth |
| **practices** / **practice_settings** | name, logoUrl, colors, carePlanTerms | No | Business branding | Settings |
| practice_settings | mcpApiKey | No* | Secret (access control to PHI APIs) | Settings → Grok connector |
| practices | ghlWebhookSecret / stripe IDs | No* | Secrets / billing | Settings / Stripe |
| **providers** | name / specialty | Maybe | Workforce; specialty not patient PHI | Providers page |
| **goals**, **treatments**, **care_plan_templates**, **patient_types**, **daily_appointments** (counts), **advanced_metrics_inputs**, **projects** / tasks (generic ops) | (various) | No / Maybe | Ops metrics; project task text could name patients | Goals, Services, Daily Log, Projects |
| **feedback** | message / userName / practiceName | Maybe | Free-text may paste PHI | Feedback button / Admin |
| **conversations** / **messages** | title / content | **Yes** if used with clinical chat | No practice scoping; content unconstrained | Replit chat integration (if enabled) |
| **sessions** | sess (jsonb) | Maybe | Session may hold user identity | Server-side only |
| **MCP tool responses** | intakes, checklists, etc. | **Yes** | Returns patient names & checklist PHI to AI clients holding API key | External Grok/MCP clients |
| **GHL webhook payload** → project tasks | contact fields | **Yes**/Maybe | Inbound CRM contact data into projects | Webhook → Projects |

\*System IDs and secrets are not PHI by themselves but protect or link to PHI.

---

## 5. Security-relevant pieces already present

| Capability | Status |
|------------|--------|
| Practice-scoped storage APIs | Present — most CRUD takes `practiceId` |
| Auth middleware | `isAuthenticated`, `requirePractice`, `requireSuperAdmin` |
| Password hashing | `bcryptjs` for local users |
| Sessions in Postgres | `sessions` table (Replit Auth pattern) |
| HIPAA-oriented audit log | `audit_logs` table; `logAudit()`; Admin UI labeled HIPAA §164.312(b); **writes currently focused on `patient_intakes` (+ some MCP checklist access)** |
| Super-admin + impersonation | Present with banner / exit |
| AWS BAA deployment playbook | Docs + reference PDF |
| S3 private-bucket design | Presign upload + app proxy (intent) |
| Import AI masking | `prepareSampleDataForAI` masks email/phone/SSN-like/address/partial names before OpenAI |
| GHL webhook HMAC | Optional signature verify; shared secret stored on practice |
| MCP API key per practice | Bearer or `?key=` → resolve practice |
| Stripe webhook handling | Present |
| Suspended practices / plans / trial wall | Present |
| Digest logging + retention prune | Digest runs/logs with prune for digest logs (audit log 6-year prune **not** active — UI notes this) |

---

## 6. Gaps vs multi-tenant HIPAA SaaS

1. **No org layer** — Tenant = practice only. Multi-location orgs, BA relationships, or reseller hierarchies need `organizations` → `practices` → `memberships`.
2. **Shared DB without RLS** — Isolation depends on every query passing `practiceId`; defaults of `"default"` and any missed filter = cross-tenant leak risk.
3. **Incomplete audit coverage** — Reads/writes of `patients`, `care_plans`, `appointments`, imports (`rawData`), revenue-by-patient, and most list endpoints are not consistently audited; audit failure only `console.error`s.
4. **RBAC thin** — `role` stored but staff vs admin rarely gated; any practice user can typically mutate PHI and generate MCP keys / invites (verify intended).
5. **Unauthenticated upload/object routes** — Presigned URL minting and `/objects/*` download lack auth/ownership checks in current handlers.
6. **Hardcoded demo-seed secret** in source (`/api/admin/seed-demo-practice`) — temporary endpoint flagged in comments; must remove before prod hardening.
7. **Secrets in agent memory folder** — `.agents/memory/aws-session-cookie.md` present in snapshot (credential hygiene issue for any shared zip/repo).
8. **Outbound PHI channels** — MCP returns full intake names; OpenAI gets masked samples (names partially masked, not eliminated); email digests; GHL ingress; Resend.
9. **No application-level encryption** of PHI fields (relies on RDS/S3 at-rest encryption from AWS).
10. **Password policy weak** — min 6 characters in Zod schema.
11. **Chat schema unscoped** — `conversations`/`messages` without `practiceId`.
12. **Console logging** — Production still logs some emails/errors; audit failures log practiceId/action (dev gates many errors with `isDev`).
13. **Impersonation** — Powerful break-glass; needs stricter audit, time limits, dual control for SaaS HIPAA.
14. **API key in query string** — MCP `?key=` risks leakage via logs/Referer.
15. **Retention** — Audit UI states 6-year retention required; automated prune “planned but not yet active.”

---

## 7. Recommended multi-tenant data model sketch (foundation)

```
organizations          # legal entity / customer account (BAA counterparty)
  id, name, billing_customer_id, status, created_at

practices              # clinic / location (maps to today's practices)
  id, org_id, name, branding…, plan, suspended…

org_memberships / practice_memberships
  user_id, org_id and/or practice_id, role (owner|admin|clinician|staff|billing|readonly)
  status, invited_at, accepted_at

users                  # unify local_users + Replit users over time
  id, email, password_hash?, mfa_*, status

roles_permissions      # explicit RBAC matrix (resource × action)

All PHI tables         # patients, intakes, care_plans, import_rows, checklists, …
  org_id + practice_id  (org for billing/BA; practice for day-to-day isolation)
  OPTIONAL: Postgres RLS policies on practice_id / org_id

audit_logs             # append-only; cover PHI read/write/export/MCP/impersonation
  org_id, practice_id, actor, action, resource, ip, hash-chain or WORM storage later

secrets                # mcp keys, webhook secrets — hashed at rest, never logged
```

**Path B implication:** Assume patient names, DOB, contact, condition, care-plan identity, import raw rows, and checklist notes are ePHI from day one — encrypt in transit (TLS), encrypt at rest (RDS/S3 KMS), minimize in logs, BAA every subprocessors (OpenAI, Resend, Stripe, AWS, email, AI MCP clients).

---

## 8. Top risks to address in foundation weeks

1. **Tenant isolation hardening** — Add `org_id`, eliminate `"default"` practiceId defaults, consider Postgres RLS, automated cross-tenant tests.
2. **Close unauthenticated file surfaces** — Auth + practice ownership on upload URL and object GET; deny public ACL for anything that could hold PHI.
3. **Expand audit logging** — Patients, care plans, imports, exports/PDFs, MCP tool calls, impersonation start/end; immutable retention plan.
4. **RBAC + least privilege** — Enforce roles on staff invite, settings, import, MCP key rotation, delete PHI.
5. **Remove temp/hardcoded secrets & scrub agent memory credentials** from any distribution of source.
6. **Subprocessor / AI governance** — Document BAAs for OpenAI/Resend; tighten MCP (no query-string keys; scope tools; audit every PHI tool call — partially started for checklists).
7. **Password/MFA & session hardening** — Stronger password policy, optional MFA, secure cookie flags review for App Runner.
8. **PHI in imports** — Retention/TTL on `import_rows.rawData`; encrypt or purge after successful import.
9. **Impersonation controls** — Mandatory audit, reason code, short TTL.
10. **Observability without PHI** — Structured logs with IDs only; redact names/emails in `console` and APM.

---

## 9. Extraction confirmation

- **Path:** `/workspace/chiro-kpi-source/`
- **This briefing:** `/workspace/chiro-kpi-source/WEEK1-BRIEFING.md`
- Work stayed on the workspace copy only; live Replit / production untouched.

*Inventory generated 2026-09-17 PT from source snapshot. Re-verify against live schema if production has drifted since the zip date.*

---

## 10. Scope decisions (2026-09-17)

Chris confirmed for the Path B rebuild:

1. **No ChiroTouch import** — do not port ChiroTouch EOD parsers, CT-specific import UI, or CT-recommended import flows into v1 of the rebuild.
2. **No OpenAI integration** — do not port import AI column mapping, OpenAI client usage, or any OpenAI-dependent features. Removes OpenAI as a subprocessor/BAA dependency for v1.

**Plan impact:**
- Weeks 14–15 shrink: keep optional generic CSV/Excel import only if still wanted; drop CT/SimplePractice AI mapping work from critical path (confirm SimplePractice separately if needed).
- HIPAA surface smaller: one fewer AI subprocessor; less outbound data risk from masked samples to OpenAI.
- Existing Replit app can keep these features until cutover; rebuild simply omits them unless re-requested.

**Import v1 (confirmed):** Simple CSV/Excel import only. No ChiroTouch parsers, no SimplePractice-specific formats, no OpenAI column mapping.
