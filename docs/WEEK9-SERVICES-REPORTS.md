# Week 9 — Services / Treatments + Reports (parity chunk 4)

Path B isolation (`org_id` + `practice_id` on tenant rows) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports the legacy **Services** catalog (treatments + prices) and **Reports** (period preview + a tenant-scoped PDF). Care Plan Generator may **consume** this catalog later; this chunk is list + reporting only. Reports are **not emailed**.

---

## Data model

`treatments` is the practice service catalog. There is **no** `"default"` `practiceId`.

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. No `"default"`. |
| `name` | Display name. |
| `description` | Optional free-text. Not encrypted (not patient PHI). Audit logs still omit the text. |
| `category` | String. Known values: Adjustment, Therapy, Exam, X-ray, Massage, Other. Other labels are stored as typed. Case-insensitive match folds onto the known label. |
| `price_cents` | Integer USD cents, ≥ 0 |
| `active` | Boolean. Default `true`. Soft-hide without deleting. |
| `sort_order` | Integer. Default `0`. Lower first within the list. |
| `created_at` / `updated_at` | Timestamps |

**Money:** storage is **integer cents**. The HTTP API also returns `price` as dollars (`priceCents / 100`) and `priceDisplay` (`$65.00`). Writes accept `price` (dollars, rounded to the nearest cent) or `priceCents`. If both are sent they must match.

Treatments are **not** patient PHI. They still require both tenant keys so Practice A cannot read Practice B’s price book.

---

## RBAC

| Action | Roles |
|--------|--------|
| List / read treatments, report preview, PDF export | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| Create / update treatments | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`). `readonly` is blocked. |
| Delete treatments | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

---

## Treatment APIs

All routes require an authenticated practice membership. Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/treatments` | Optional `active=true\|false`. Grouped by category. |
| GET | `/api/treatments/:id` | 404 if missing or other practice. |
| POST | `/api/treatments` | Create. Staff+. |
| PATCH | `/api/treatments/:id` | Partial update. |
| DELETE | `/api/treatments/:id` | Owner/admin. |

List empty states: `no_treatments` (zero rows), `no_matches` (filter hid them), `has_data`.

List responses include:

```json
"carePlanGenerator": {
  "available": false,
  "reason": "Care Plan Generator lands in a later chunk. This catalog is the price book only."
}
```

### Audit

Create, update, delete, list, and read are audited (`resourceType: "treatment"`). Metadata holds **IDs, field names, category, counts** — never description text.

---

## Reports

`GET /api/reports/preview` and `GET /api/reports/export.pdf` share one computation.

Query: `period=weekly|monthly|quarterly|annual|custom`. Custom also requires `from` and `to` (`YYYY-MM-DD`). Max range is 366 days.

### Period definitions

| `period` | Current window | Comparison window |
|----------|----------------|-------------------|
| `weekly` | Monday of the current UTC week through **today** (partial week) | Immediately preceding window of the **same number of calendar days** |
| `monthly` | 1st of the current UTC month through **today** | Same: equal-length window ending the day before the current start |
| `quarterly` | First day of the current UTC quarter through **today** | Same equal-length rule |
| `annual` | January 1 of the current UTC year through **today** | Same equal-length rule |
| `custom` | `from`–`to` inclusive | Equal-length window immediately before `from` |

The response always names the comparison:

```json
{
  "period": { "key": "weekly", "from": "2026-09-14", "to": "2026-09-16", "label": "…", "dayCount": 3 },
  "comparisonLabel": "Previous 3-day period",
  "comparisonDefinition": "Equal-length window immediately before the current start. Not the previous calendar week/month/quarter/year unless the lengths happen to match.",
  "previousFrom": "2026-09-11",
  "previousTo": "2026-09-13"
}
```

`weekly` on 2026-09-16 is the same window as dashboard `this_week`. `monthly` matches dashboard `this_month`.

### What is in a preview

KPI tiles **reuse the dashboard formulas** (visits, revenue, OVA, new patients, conversion, percent change, empty states, revenue-without-visits anomalies). See [WEEK6-DAILY-DASHBOARD.md](./WEEK6-DAILY-DASHBOARD.md) and [WEEK8-PATIENTS.md](./WEEK8-PATIENTS.md).

**Goals summary:** goals whose `[startDate, endDate]` **overlaps** the report window. Status and current values use the Week 7 rules (revenue/visits summed from `daily_stats`). Goal notes are not returned.

**Referral leaderboard:** same `converted / new in period` grouping as `/api/patients/referral-leaderboard`.

**Trend series:** visits and revenue from the daily log.

| Window length | Grain |
|---------------|--------|
| Fewer than 46 days | One point per calendar day (UTC), including days with no row (0 / $0) |
| 46 days or more | ISO week (Monday). First/last weeks may be **partial** — only days inside the report window are counted. |

### PDF

`GET /api/reports/export.pdf` returns `application/pdf` for the same query as preview. Tenant-scoped. Audited as `action: "export"`, `resourceType: "report"` (period, byte length — no patient names). Generated with pdfkit on the server.

Reports are **not emailed** in this chunk.

---

## UI

- `/treatments` — categorized list, add/edit, empty state. `/services` redirects here.
- `/reports` — period picker, KPI tiles, goals / referral / trend tables, Download PDF.
- Nav: Dashboard · Daily Log · Goals · Patients · **Services** · **Reports**.

---

## Out of scope (this week)

Checklists, onboarding flows, Care Plan Generator (beyond consuming this catalog later), Projects, Advanced Metrics, CSV import, emailed reports, new Stripe work.
