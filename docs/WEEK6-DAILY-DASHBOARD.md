# Week 6 — Daily Log + Dashboard KPIs (parity chunk 1)

Path B isolation (`org_id` + `practice_id` on PHI) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports the legacy **Daily Log** (one row per clinic day) and the **Practice Dashboard KPI overview** (visits, revenue, office visit average) onto the SaaS foundation.

---

## Data model

`daily_stats` is the Daily Log table. There is **no** split into `daily_appointments` + `revenue` in this rebuild — one row holds both counts for the day.

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. No `"default"`. |
| `date` | `YYYY-MM-DD`. Unique per practice. |
| `visits` | Integer ≥ 0 |
| `revenue_cents` | Integer USD cents ≥ 0 |
| `notes` | Optional free-text. AES-256-GCM at rest (`PHI_ENCRYPTION_KEY`). Treat as possible PHI. |
| `created_by` | Optional user id of the creator |
| `created_at` / `updated_at` | Timestamps |

**Money:** storage is **integer cents**. The HTTP API also returns `revenue` as dollars (`revenueCents / 100`) and accepts `revenue` (dollars, rounded to the nearest cent) or `revenueCents`. If both are sent they must match.

**Dates:** calendar days in **UTC** until a practice timezone exists. The today helper uses `toYmd(now())` in UTC. Enter the clinic’s business date explicitly when you are not on UTC.

KPIs are **computed** from these rows. Nothing is duplicated into a snapshot table.

---

## RBAC

| Action | Roles |
|--------|--------|
| List / read daily log and dashboard | `owner`, `admin`, `clinician`, `staff`, `readonly` (any practice member) |
| Create / update daily log | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`). `readonly` is blocked. |
| Delete daily log | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`).

---

## Daily Log APIs

All routes require an authenticated practice membership. Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/daily-log?from=&to=` | Default range: today and the previous 29 days (30 inclusive). |
| GET | `/api/daily-log/today` | `{ today, entry }` — `entry` is `null` if nobody has logged today yet. |
| GET | `/api/daily-log/:date` | `:date` is `YYYY-MM-DD` or `today`. 404 if missing. |
| POST | `/api/daily-log` | Create. `date` defaults to today. 409 `duplicate_date` if that day exists. |
| PATCH | `/api/daily-log/:date` | Partial update. |
| DELETE | `/api/daily-log/:date` | Owner/admin. |

### Validation

- Negative `visits` or `revenue` → `400 invalid_input`.
- `visits` must be an integer.
- Revenue > 0 and visits === 0 is **allowed**. The response includes `warnings: [{ code: "revenue_without_visits", message }]`. The row is saved.

### Audit

Create, update, delete, list, and read are audited (`resourceType: "daily_log"`). Metadata holds **IDs, field names, warning codes, counts** — never note contents.

---

## Dashboard API

`GET /api/dashboard?period=this_week|this_month|custom`

Custom also requires `from` and `to` (`YYYY-MM-DD`). Max range is 366 days.

### Period definitions

| `period` | Current window | Comparison window |
|----------|----------------|-------------------|
| `this_week` | Monday of the current UTC week through **today** (partial week) | The immediately preceding window of the **same number of calendar days** |
| `this_month` | 1st of the current UTC month through **today** | Same: equal-length window ending the day before the current start |
| `custom` | `from`–`to` inclusive | Equal-length window immediately before `from` |

The response always names the comparison:

```json
{
  "period": { "key": "this_week", "from": "2026-09-14", "to": "2026-09-16", "label": "…", "dayCount": 3 },
  "comparisonLabel": "Previous 3-day period",
  "previousFrom": "2026-09-11",
  "previousTo": "2026-09-13"
}
```

Example: `this_month` on 2026-09-16 is 2026-09-01..2026-09-16 (16 days), compared with 2026-08-16..2026-08-31.

This matches the legacy app’s “same length, immediately before” comparison (not “previous calendar month” unless the lengths happen to match).

### Formulas

**Patient visits** = sum of `visits` in the window.

**Revenue** = sum of `revenue_cents` in the window (returned as dollars and cents).

**Office visit average (OVA)** = `revenue_cents / visits`, rounded to the nearest cent, then expressed in dollars. **`null` when visits = 0** (division is undefined). The response includes an `explanation`.

**Percent change**

```
percentChange = previous === 0
  ? null
  : ((current - previous) / previous) * 100
```

Rounded to 1 decimal. **`null` when previous is 0** — we do not invent `+100%`. The UI shows “No baseline”. Revenue percent change is computed from **integer cents**.

**New patients / conversion:** `{ available: false, reason }` until intake conversion fields exist. Do not treat a zero as “no new patients”.

### Empty states

| `emptyState` | Meaning |
|--------------|---------|
| `no_entries` | Zero daily-log rows in the window |
| `zeros_recorded` | Rows exist, but every row has visits = 0 and revenue = 0 |
| `has_data` | At least one non-zero visits or revenue value |

Anomaly list: `anomalies.revenueWithoutVisits` — days in the window with revenue > 0 and visits = 0.

---

## UI

- `/` and `/dashboard` — KPI cards from `/api/dashboard`, billing strip from Week 5, patient stub, invites.
- `/daily-log` — date range filter, table (date / visits / revenue / notes), add or edit today.
- Nav: Dashboard · Daily Log.

Honest empty copy and an amber banner when zero-visits + revenue days exist.

---

## Out of scope (this week)

Goals, full patients conversion funnel, care plans, checklists, reports PDF, imports beyond the existing 501 stub, deeper Stripe work.
