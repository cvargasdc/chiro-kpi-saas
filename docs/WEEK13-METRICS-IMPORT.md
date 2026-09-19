# Week 13 — Advanced Metrics + generic CSV/Excel import (parity chunk 8)

Path B isolation (`org_id` + `practice_id` on tenant rows) is unchanged. No OpenAI. No ChiroTouch parsers. No SimplePractice-specific formats. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports **Advanced Metrics** (GET / SELL / KEEP & EARN) and a **generic spreadsheet import**. Together with Weeks 6–12, this completes the planned core product-parity list. Stripe BAA / live keys remain deferred hooks.

---

## Advanced Metrics

### Data model

`advanced_metrics_inputs` stores **manual** figures only.

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. No `"default"`. |
| `period_month` | First calendar day of the month (`YYYY-MM-01`) |
| `section` | `get` \| `sell` \| `keep` |
| `key` | Catalog key (e.g. `monthly_leads`) |
| `value_numeric` | Optional number. Counts are whole numbers; money is **dollars** (not cents) so owners can type P&L figures. |
| `value_text` | Optional. Unused by the current catalog. |
| `source` | Stored rows are `manual`. Automatic fields are computed at read time. |
| `updated_by` | User id |

Unique `(practice_id, period_month, section, key)`.

Automatic fields are **not stored**. They are derived from `daily_stats` and `patients` for the month.

### Formulas

| Key | Source | Formula | Available when |
|-----|--------|---------|----------------|
| `monthly_leads`, `consults_booked`, `patients_showed` | Manual | Entered | A value is saved for the month |
| `show_rate` | Automatic | Showed ÷ Booked × 100 | Both manual inputs present and Booked > 0 |
| `new_patients` | Automatic | `patientType=new` with activity date in the month | At least one patient row exists in the practice |
| `converted_count` | Automatic | New patients in the month with `converted=true` | Same |
| `close_rate` | Automatic | Converted ÷ new patients × 100 | `newCount > 0` |
| `case_average` | Automatic | Month Daily Log revenue ÷ new patients | Daily Log rows exist **and** `newCount > 0` |
| `thirty_day_cash_per_np` | Manual | Entered from billing | Entered |
| `pva` | Automatic | Month visits ÷ new patients | Daily Log visits > 0 and `newCount > 0` |
| `rpv` | Automatic | Month revenue ÷ visits (same as office visit average) | Daily Log visits > 0 |
| `careplan_completions`, `careplan_starts` | Manual | Entered | Entered |
| `cpr` | Automatic | Completions ÷ starts × 100 | Both entered and starts > 0 |
| `direct_costs`, `marketing_spend` | Manual | Dollars | Entered |
| `gpm` | Automatic | (Revenue − direct costs) ÷ revenue × 100 | Direct costs entered and revenue > 0 |
| `cac` | Automatic | Marketing spend ÷ new patients | Spend entered and `newCount > 0` |
| `ltgp` | Automatic | RPV × GPM% × PVA | RPV, GPM, and PVA all available |
| `ltgp_cac` | Automatic | LTGP ÷ CAC | Both available and CAC > 0 |

If there is no Daily Log in the month, RPV / PVA / case average return `available: false` with a reason. Zero visits is not the same as “no entries.”

### APIs

Tenant comes from the session (or `X-Practice-Id` after membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/advanced-metrics?month=YYYY-MM` | Sections with `label`, `key`, `value`, `source`, `helpText`, `locked` / `lockedMessage`, `dependencies`. Defaults to the current UTC month. |
| PUT | `/api/advanced-metrics` | `{ month, fields: [{ key, value }] }`. Staff+. Manual keys only. |
| GET | `/api/advanced-metrics/prompt?month=YYYY-MM` | Copy-paste analysis prompt. **Aggregates only** (no patient names). Local string builder. **No OpenAI call.** |

### RBAC

| Action | Roles |
|--------|--------|
| GET metrics / prompt | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| PUT manual fields | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`) |

Writes also pass the billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

### Audit

List / read / update are audited (`resourceType`: `advanced_metrics` or `advanced_metrics_prompt`). Metadata holds **month, field keys, availability flags** — never the numeric values themselves (practice-level figures can still be sensitive; we do not log them).

### UI

`/advanced-metrics` — month picker, GET / SELL / KEEP & EARN cards, manual inputs (save on blur), locked dependency copy, “How to find this number,” honest empty/zero banners, Generate prompt (copy). Nav: **Advanced Metrics**.

---

## Generic CSV / Excel import

Replaces the Week 2 **501 stub**. There is still **no** ChiroTouch EOD parser, **no** SimplePractice SPAA/SPAT parser, and **no** OpenAI column mapping.

### Data model

#### `import_batches`

`org_id` + `practice_id` required. `status`: `uploaded` \| `mapped` \| `previewed` \| `committed` \| `failed`. `column_mapping` and `headers` are JSON. `raw_expires_at` is set at upload (`createdAt + 30 days`).

#### `import_rows`

Each spreadsheet body row. `raw_data` is a JSON array of cells, **AES-256-GCM** when `PHI_ENCRYPTION_KEY` is set. `normalized_data` after mapping is also encrypted and **does not store patient names** (dates, counts, flags only). `content_hash` is SHA-256 of the plaintext cell JSON (integrity, not a substitute for encryption).

### Raw-row TTL

`IMPORT_RAW_TTL_DAYS = 30`. After expiry, `pruneExpiredImportRawRows(storage, now)` clears `raw_data` and `normalized_data` but **keeps** batch history (file name, counts, status). The prune function is a **stub** — it is not scheduled. Do not enable automated prune until retention is reviewed.

### APIs

Owner/admin only (legacy super-admin vibe). Staff and readonly are blocked, including list.

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/import/upload` | JSON `{ fileName, csv }` or `{ fileName, xlsxBase64 }`. Stores batch + encrypted rows. Upload sample masks emails, phones, and non-numeric cells. |
| GET | `/api/import/batches` | History. No cell payloads. |
| GET | `/api/import/batches/:id` | Headers + mapping. |
| POST | `/api/import/batches/:id/map` | `{ mappings: [{ sourceColumn, targetField }] }` to Daily Log and/or Patients fields. |
| POST | `/api/import/batches/:id/preview` | Dry run counts + masked sample. **Does not write** Daily Log or Patients. |
| POST | `/api/import/batches/:id/commit` | Tenant-scoped writes. Duplicate Daily Log dates update in place. `revenue_without_visits` warnings included. |

xlsx is parsed with SheetJS (first sheet, first row = headers). CSV is parsed locally (quoted fields, BOM). Max 5,000 rows.

### Preview PHI masking

Mapped name/email/phone/DOB/notes/condition cells in the preview sample are masked (`J*** D***`, `***@domain`, last-4 phone, `[redacted]` notes). Dates, visits, and revenue stay visible.

### RBAC

| Action | Roles |
|--------|--------|
| Upload / map / preview / commit / history | `owner`, `admin` (`ORG_ADMIN_ROLES`) |

### Audit

Upload / list / map / preview / commit are audited (`resourceType`: `import_batch` or `import_preview`). Metadata holds **counts, file type, mapped field names, warning codes** — not file names that might identify a clinic export, not cell values, not patient names.

### UI

`/import` — upload → map → preview → confirm; History tab. Nav: **Import** (owner/admin only). Other roles see an explanation, not the wizard.

---

## Encryption

`PHI_ENCRYPTION_KEY` covers import `raw_data` / `normalized_data` in addition to existing patient / daily-log / goal / onboarding / care-plan / project-task fields. Advanced metric inputs are practice aggregates and are stored as plaintext numbers (not encrypted). RDS encryption-at-rest is still required.

---

## Out of scope (still deferred)

Live Stripe / BAA countersignature, emailed reports, OpenAI, ChiroTouch parsers, SimplePractice-specific formats, GHL CRM webhook, Replit.

This completes the planned **core product parity** list for the Path B rebuild.
