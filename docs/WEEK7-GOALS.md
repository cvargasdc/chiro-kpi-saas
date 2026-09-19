# Week 7 — Practice Goals (parity chunk 2)

Path B isolation (`org_id` + `practice_id` on PHI) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports the legacy **Goals** tracker: named targets with progress bars, pace statuses, currency display, and dashboard behind-pace alerts. Revenue and visits are wired to `daily_stats` (Week 6 Daily Log). Conversion / new-patient goals are **not** in this chunk.

---

## Data model

`goals` is the practice-target table. There is **no** `"default"` `practiceId`.

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. No `"default"`. |
| `name` | Display title. API also accepts `title` as an alias on write. |
| `metric_type` | `revenue` \| `visits` \| `custom` |
| `target_value` | Integer. **USD cents** when `metric_type = revenue`. Integer count otherwise. |
| `current_value` | Stored **only** for `custom`. Null for revenue/visits. |
| `time_period` | `weekly` \| `monthly` \| `quarterly` \| `yearly` \| `custom`. UI preset only; math uses the date window. |
| `start_date`, `end_date` | `YYYY-MM-DD`, inclusive. UTC until a practice timezone exists. |
| `notes` | Optional free-text. AES-256-GCM at rest (`PHI_ENCRYPTION_KEY`). Treat as possible PHI. |
| `created_by` | Optional user id of the creator |
| `created_at` / `updated_at` | Timestamps |

**Status is derived at read time.** It is not a stored column.

**Current value**

| `metric_type` | Source |
|---------------|--------|
| `revenue` | `sum(daily_stats.revenue_cents)` in `[startDate, min(today, endDate)]` inclusive |
| `visits` | `sum(daily_stats.visits)` in the same window |
| `custom` | Stored `current_value` (manual). Default 0. |

Future days after `today` are not counted even if `endDate` is still ahead. Days before `startDate` are not counted. Practice B’s daily log never contributes to Practice A’s goals.

Unlike the legacy app, `endDate` is **inclusive** (legacy stored an exclusive end by adding one day in the UI).

---

## Money

Storage is **integer cents** for revenue goals, matching Daily Log.

The HTTP API also returns:

- `targetValue` / `currentValue` / `expectedValue` — native units (cents or count)
- `target` / `current` / `expected` — dollars (number) for revenue; same integer for visits/custom
- `targetDisplay` / `currentDisplay` / `expectedDisplay` — formatted strings

Display rules:

- Compact at **$10,000+**: `$70K`, `$180K`, `$1.5M`
- Below that: full currency, `$1,800.00`
- **Never** emit a raw `$180000` / `$70000` string. Numeric JSON fields may still be `70000` (dollars, no `$`).

Writes accept `target` (dollars) or `targetValue` (cents) for revenue. If both are sent they must match.

---

## Linear expected progress

```
totalDays    = inclusive calendar days in [startDate, endDate]
elapsedDays  = 0                         if today < startDate
             = totalDays                 if today > endDate
             = inclusive days [startDate, today] otherwise
expected     = target * (elapsedDays / totalDays)
```

`expectedValue` is that quantity rounded to the nearest integer (nearest cent for revenue).

`daysRemaining` is inclusive days from `today` through `endDate`, or `0` if `today > endDate`.

`progressPercent = round((current / target) * 100)` and **may exceed 100**. The UI caps the bar at 100%.

---

## Status rules

First match wins.

| Status | Rule |
|--------|------|
| **Achieved** | `current >= target` (and `target > 0`). Wins even after `endDate` — the window sum already excludes days after `endDate`. |
| **Expired** | `endDate < today` and not achieved. |
| **Below Target** | Past midpoint (`elapsedDays / totalDays >= 0.5`) **and** `current < expected * 0.75` (25%+ behind linear expected). Integer form: `current * totalDays * 4 < target * elapsedDays * 3`. |
| **Behind Pace** | More than **one day’s** linear progress behind expected: `current < expected − (target / totalDays)`. Integer form: `current * totalDays < target * (elapsedDays − 1)`. Not applied on day 0 or day 1 (zero current on the start date is On Pace). |
| **On Pace** | Otherwise, including “not started” (`today < startDate`) and ahead-of-pace but not yet at target. |

Worked example (10-day window 2026-09-10..2026-09-19, today 2026-09-16, target 100):

- `totalDays = 10`, `elapsedDays = 7`, `expected = 70`
- current 100 → Achieved
- current 70 → On Pace
- current 55 → Behind Pace (`55 < 60`)
- current 50 → Below Target (`50 < 52.5` and past midpoint)
- after 2026-09-19 with current 80 → Expired

---

## RBAC

| Action | Roles |
|--------|--------|
| List / read goals | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| Create / update | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`). `readonly` is blocked. |
| Delete | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

---

## APIs

All routes require an authenticated practice membership. Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/goals` | Active practice. Computed progress on every row. |
| GET | `/api/goals/:id` | 404 if missing or other practice. |
| POST | `/api/goals` | Create. `name` or `title` required. |
| PATCH | `/api/goals/:id` | Partial update. |
| DELETE | `/api/goals/:id` | Owner/admin. |

### Query

`GET /api/goals?includeExpired=true` includes `status = expired` rows. Default **omits** expired goals.

The list always returns `expiredCount` (how many goals are expired), even when they are hidden.

```json
{
  "today": "2026-09-16",
  "includeExpired": false,
  "expiredCount": 1,
  "emptyState": "has_data",
  "goals": [
    {
      "id": "…",
      "name": "September collections",
      "metricType": "revenue",
      "targetValue": 7000000,
      "target": 70000,
      "targetDisplay": "$70K",
      "currentValue": 100000,
      "current": 1000,
      "currentDisplay": "$1,000.00",
      "expectedValue": 3733333,
      "status": "below_target",
      "statusLabel": "Below Target",
      "progressPercent": 1,
      "elapsedDays": 16,
      "totalDays": 30,
      "daysRemaining": 15,
      "currentSource": "daily_stats",
      "expectedFormula": "target * (elapsedDays / totalDays)"
    }
  ]
}
```

### Validation

- Missing name/title → `400 name_required`
- `startDate > endDate` → `400 from_after_to`
- Window longer than 3 × 366 days → `400 range_too_long`
- Revenue `target` and `targetValue` disagree → `400 target_mismatch`
- Target ≤ 0 → `400 invalid_input`

Revenue `currentValue` on create/update is **ignored** (computed from the daily log). Custom `currentValue` is stored.

### Audit

Create, update, delete, list, and read are audited (`resourceType: "goal"`). Metadata holds **IDs, field names, metricType, counts** — never note contents.

---

## UI

- `/goals` — cards with progress bars, status chips, date ranges, add/edit/delete. Empty state when none. Toggle “Show expired”.
- `/` and `/dashboard` — active goals summary plus an amber behind-pace / below-target alert with a link to `/goals`.
- Nav: Dashboard · Daily Log · Goals.

---

## Out of scope (this week)

Patients conversion funnel, care plans, checklists, reports PDF, projects, new-patient / conversion metric types, imports beyond the existing 501 stub, deeper Stripe work.
