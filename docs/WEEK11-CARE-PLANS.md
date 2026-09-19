# Week 11 — Care Plan Generator (parity chunk 6)

Path B isolation (`org_id` + `practice_id` on tenant rows) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports the legacy **Care Plan Generator**: a financial plan from the Services catalog (treatments × quantities), payment-option quotes, saved plans, optional templates, and a tenant-scoped PDF. The legacy compliance modal could not be dismissed without acknowledge; this rebuild is a **proper gate**.

---

## Compliance gate

The generator is locked until the current user acknowledges the notice for this practice.

| Action | Result |
|--------|--------|
| **I Acknowledge** | Stored per user+practice, copied into the session, audited, unlocks create/update/generate |
| **Close** | Returns to the dashboard. Does **not** unlock the generator |

`GET /api/care-plans/compliance` returns notice text plus `acknowledged` from **session or stored ack**. `POST /api/care-plans/compliance/acknowledge` records the ack and writes an audit row (`resourceType: "care_plan_compliance"`, `action: "acknowledge"`). Metadata is field names only — never patient names.

Create, update, delete, template writes, and PDF export require a prior ack. Missing ack → `403` with `{ "error": "compliance_required", "code": "compliance_required" }`. List/get of existing plans and the compliance endpoints themselves do not require ack.

Default notice (overridable on `practice_settings.compliance_notice`): care-plan rules vary by state; generated plans are a financial aid; the licensed practitioner is responsible for compliance.

---

## Data model

No `"default"` `practiceId`.

### `care_plans`

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. |
| `patient_id` | Optional FK to `patients` (`ON DELETE SET NULL`). Plans can be named without linking a patient row. |
| `first_name_enc`, `last_name_enc`, `notes_enc` | ePHI. AES-256-GCM at rest (`PHI_ENCRYPTION_KEY`). Storage callers see plaintext. |
| `treatment_selections` | JSON array. See shape below. |
| `payment_settings` | JSON object. See shape below. |
| `subtotal_cents` | Integer USD cents, computed on write from the catalog. Client-supplied totals are ignored. |
| `status` | `draft` \| `final`. Default `draft`. |
| `compliance_acknowledged_at` / `compliance_acknowledged_by` | Snapshot of the ack used when the plan was created. |
| `created_by` | User id. |

### `care_plan_templates`

`name`, `default_selections` JSON (`treatmentSelections` + `paymentSettings`), `active`. Not patient PHI (no names). Still tenant-scoped.

### `practice_settings`

One row per practice. Optional `care_plan_terms` (PDF terms of agreement) and `compliance_notice` (override of the default gate text). Not PHI.

### `care_plan_compliance_acks`

Per-user stored ack (`unique (practice_id, user_id)`). Combined with the session flag.

---

## Treatment selections and payment settings

`treatment_selections` (array; a `{ [treatmentId]: quantity }` map is also accepted on write):

```json
[
  {
    "treatmentId": "…",
    "quantity": 12,
    "name": "Cervical adjustment",
    "unitPriceCents": 6500
  }
]
```

`name` and `unitPriceCents` are snapshots at save time (used if the catalog row is later removed). **Subtotal is always** `sum(treatments.priceCents * quantity)` from the live catalog at create/update.

`payment_settings`:

```json
{
  "payInFull": { "enabled": true, "discountPercent": 10 },
  "monthlyPlan": { "enabled": true, "discountPercent": 5, "months": 6 },
  "downPaymentPlan": {
    "enabled": true,
    "discountPercent": 7,
    "months": 4,
    "downPaymentPercent": 30
  },
  "planStartDate": null
}
```

| Option | Meaning |
|--------|---------|
| Pay in full (Platinum) | `subtotal - percent(subtotal, discountPercent)` |
| Monthly (Silver) | Same discount, then `round(total / months)` per month |
| Down payment (Gold) | Discount, then `percent(total, downPaymentPercent)` down and `round(remainder / months)` |

Percents are 0–100. Months are 1–120. Quotes are integer cents (nearest cent). Write aliases: `discount` → `discountPercent`, `downPaymentPercentage` → `downPaymentPercent`.

---

## RBAC

| Action | Roles |
|--------|--------|
| Compliance GET/ack, list/read plans and templates, PDF | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| Create / update plans and templates | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`) |
| Delete plans or templates | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

---

## APIs

Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/care-plans/compliance` | Notice + `acknowledged` / `source` (`session` \| `stored` \| `null`) |
| POST | `/api/care-plans/compliance/acknowledge` | Store ack + session + audit |
| GET | `/api/care-plans` | Empty state `no_plans` \| `has_data` |
| GET | `/api/care-plans/:id` | 404 if missing or other practice |
| POST | `/api/care-plans` | Staff+. Requires ack. Optional `saveAsTemplate` + `templateName` |
| PATCH | `/api/care-plans/:id` | Partial update. Recalculates subtotal from the catalog |
| DELETE | `/api/care-plans/:id` | Owner/admin. Requires ack |
| GET | `/api/care-plans/:id/export.pdf` | `application/pdf`. Requires ack. Audited |
| GET | `/api/care-plan-templates` | Optional `active=true\|false` |
| POST / GET / PATCH / DELETE | `/api/care-plan-templates/:id` | Writes require ack; delete is owner/admin |

`GET /api/treatments` now reports `carePlanGenerator.available: true`.

### Audit

List/read/create/update/delete/export of plans, template writes, and compliance ack/read are audited. Metadata holds **IDs, field names, counts, status, subtotal cents, PDF byte length** — never first/last name, notes, or search text.

### PDF

Generated with pdfkit on the server. Includes patient name, services, payment quotes, notes, terms (`practice_settings.care_plan_terms` or the default template with `{practiceName}`), and a compliance footer. Tenant-scoped. Not emailed.

---

## UI

- `/care-plan-calculator` — compliance modal first. After ack: patient fields, catalog multi-select with quantities, payment options, live totals, save, saved-plan list, PDF download, optional save-as-template. `/care-plans` redirects here.
- Close on the modal returns to the dashboard without unlocking.
- Empty catalog → prompt to add Services.
- Nav: **Care Plans**.

---

## Encryption

`PHI_ENCRYPTION_KEY` (AES-256-GCM) covers care-plan first name, last name, and notes in addition to existing patient / daily-log / goal / onboarding notes. Storage callers always see plaintext. RDS encryption-at-rest is still required.

---

## Out of scope (this week)

Advanced Metrics, CSV import, emailed reports, new Stripe work, OpenAI, ChiroTouch. (Projects: see [WEEK12-PROJECTS.md](./WEEK12-PROJECTS.md).)
