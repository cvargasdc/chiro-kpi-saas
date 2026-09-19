# Week 8 — Patients + conversion funnel (parity chunk 3)

Path B isolation (`org_id` + `practice_id` on PHI) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports the legacy **Patients** page: New vs Wellness tabs, referral tracking, conversion leaderboard, Day 1 / Day 2, care status, and a real profile destination. Dashboard new-patient / conversion KPIs become `available: true` when the practice has at least one patient row.

---

## Data model

Conversion funnel fields live on **`patients`**. The legacy split (`patients` + `patient_intakes` as two operational lists) is **unified** so a person is one PHI row.

`patient_intakes` remains in the schema as a reserved table for later onboarding / checklists. It is not the list API and has no Week 8 routes.

There is **no** `"default"` `practiceId`.

### `patients`

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. No `"default"`. |
| `name` | Display identifier (PHI). |
| `email`, `phone`, `date_of_birth`, `notes` | Optional. AES-256-GCM at rest (`PHI_ENCRYPTION_KEY`). DOB is `text` so the envelope fits. |
| `condition` | Optional health information. |
| `status` | Record status: `active` \| `inactive`. Distinct from care status. |
| `patient_type` | `new` \| `wellness`. Default `new`. |
| `type_name` | Optional label (placeholder for later type catalogs). |
| `referral_source_id` | Optional FK to `referral_sources`. |
| `referral_source` | Denormalized source name for leaderboard grouping. |
| `day1_date`, `day2_date` | Optional `YYYY-MM-DD`. |
| `care_status` | `new` \| `in_care` \| `wellness` \| `discharged` \| `lost`. |
| `converted` | Boolean. Default `false`. |
| `conversion_date` | Set to today (UTC) when `converted` becomes true unless a date is sent. Cleared when `converted` becomes false. |
| `plan_type` | Optional. |
| `created_by` | Optional user id of the creator. |

**Activity date** (filters, KPIs, leaderboard): `day1Date` if set, otherwise the UTC calendar date of `createdAt`.

### `referral_sources`

Per-practice catalog (`name`, `active`). Tenant keys required. Creating a patient with `referralSource: "Google"` upserts a catalog row (case-insensitive match, original casing kept).

---

## Formulas

**New patients** in a period = count of `patientType = new` whose activity date is in `[from, to]` inclusive.

**Wellness patients** = same window, `patientType = wellness`.

**Conversion**

```
conversion = convertedCount / newCount
```

- Denominator: new patients in the period (wellness **excluded**).
- Numerator: those same new patients with `converted = true` (conversion date does not have to fall in the period).
- **`null` when `newCount` is 0** — we do not invent `0%` or `100%`.

Returned as a percent, 1 decimal (`50` means 50%).

**Referral leaderboard** groups the same math by `referralSource` (blank → `Unspecified`), ranked by new count then converted count.

Dashboard percent change uses the existing `((current - previous) / previous) * 100` rule (`null` when previous is 0).

---

## Availability (dashboard)

| Practice patients | KPI shape |
|-------------------|-----------|
| Zero rows | `{ available: false, reason }` — do not treat a missing funnel as “0 new patients”. |
| At least one row | `{ available: true, value, … }` even if this period’s counts are 0. |

---

## RBAC

| Action | Roles |
|--------|--------|
| List / read patients, leaderboard, referral catalog | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| Create / update / conversion toggle | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`). `readonly` is blocked. |
| Delete | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

---

## APIs

All routes require an authenticated practice membership. Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/patients` | Filters: `q`/`search`, `type`/`tab` (`all`\|`new`\|`wellness`), `month` (`YYYY-MM`), `referralSource`. Page: `limit` (default 50, max 200), `offset`. |
| GET | `/api/patients/:id` | 404 if missing or other practice. |
| POST | `/api/patients` | Create. Staff+. |
| PATCH | `/api/patients/:id` | Partial update, including `converted`. |
| POST | `/api/patients/:id/conversion` | `{ converted, conversionDate? }` |
| DELETE | `/api/patients/:id` | Owner/admin. |
| GET | `/api/patients/referral-leaderboard?from=&to=` | Default: 1st of current UTC month through today. Max 366 days. |
| GET | `/api/referral-sources` | Practice catalog. |
| POST | `/api/referral-sources` | Upsert by name. Staff+. |

Aliases on write: `type` / `category` → `patientType`.

`day2Date` before `day1Date` → `400 day2_before_day1`.

### List empty states

| `emptyState` | Meaning |
|--------------|---------|
| `no_patients` | Practice has zero patient rows |
| `no_matches` | Rows exist, but filters exclude them |
| `has_data` | At least one row in the page |

### Audit

List, read, create, update, delete, conversion, leaderboard, and referral-source writes are audited. Metadata holds **IDs, field names, counts, filter flags** — never patient names, emails, notes, or the search string.

Profile responses include a placeholder:

```json
"onboarding": {
  "available": false,
  "reason": "Checklists and onboarding flows land in a later chunk. This profile is the conversion and care-status record."
}
```

---

## UI

- `/patients` — tabs All / New / Wellness, search, month filter, table, add form, referral leaderboard panel.
- `/patients/:id` — identity, referral, dates, conversion toggle, care status, notes. Onboarding is an honest empty panel.
- `/` and `/dashboard` — New patients and New conversion KPI cards; recent patients link to the profile.
- Nav: Dashboard · Daily Log · Goals · **Patients**.

---

## Out of scope (this week)

Care Plan Generator, checklist templates / onboarding deep flows, Projects, Reports PDF, import parsers, new-patient/conversion **goal types**, Stripe changes.
