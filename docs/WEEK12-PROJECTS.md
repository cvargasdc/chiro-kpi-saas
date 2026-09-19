# Week 12 — Projects (parity chunk 7)

Path B isolation (`org_id` + `practice_id` on tenant rows) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports the legacy **Projects** board: named workspaces with kanban columns and tasks. Legacy mixed templates into the same dense card grid as live work. This rebuild keeps **Templates** in their own section.

GoHighLevel (GHL) webhook ingress that used to create tasks from CRM contacts is **out**. `POST /api/ghl/webhook` (and `POST /api/projects/ghl-webhook`) returns **501**.

---

## Template vs active (choice)

**Same `projects` table, `status` flag.** Not a separate templates table.

| Status | Meaning |
|--------|---------|
| `active` | Live board. Shown as cards on `/projects` with task counts and completion % |
| `template` | Reusable starter. Listed only under **Templates**. Duplicate to start work |
| `archived` | Hidden from the default list. Owner/admin can archive |

Duplicating a template **or** an existing project creates a new **active** project and copies columns and tasks (new IDs). Template name is reused; duplicating an active board appends ` (copy)` unless a name is supplied.

A separate templates table was rejected because columns and tasks have the same shape either way, and one duplicate path covers both. The UI never mixes template cards into the active grid.

---

## Data model

No `"default"` `practiceId`. Child rows also carry `org_id` + `practice_id`.

### `projects`

| Column | Rules |
|--------|--------|
| `org_id`, `practice_id` | Required. |
| `name` | Required. Ops label — not encrypted. |
| `description` | Optional ops text. |
| `status` | `active` \| `archived` \| `template`. Default `active`. |
| `tags` | `text[]`. Trimmed, de-duplicated, max 20 × 40 chars. |
| `created_by` | User id. |

### `project_columns`

`projectId`, `name`, `sortOrder`. Default on create: **Todo / Doing / Done**. Staff+ may add columns (max 12). Owner/admin may delete an empty column (not the last one).

### `project_tasks`

| Column | Rules |
|--------|--------|
| `projectId`, `columnId` | Required. Cascade on parent delete. |
| `title` | Plaintext. Prefer operational wording — **do not put patient names in titles**. |
| `notes` | Optional free-text. AES-256-GCM at rest (`PHI_ENCRYPTION_KEY`). Storage callers see plaintext. Spec name: notesEnc. |
| `sortOrder`, `done` | Integer order; boolean. Independent of column (moving to Done does not auto-toggle). |
| `dueDate` | Optional `YYYY-MM-DD`. |
| `assigneeName` | Optional workforce label. |

---

## Completion %

`completionPercent = round(done tasks / total tasks × 100)`. Zero tasks → **0** (not 100). List and detail both expose `doneCount`, `taskCount`, and `completionPercent`.

---

## RBAC

| Action | Roles |
|--------|--------|
| List / read | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| Create / update projects, columns, tasks; duplicate; toggle; move | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`) |
| Change `status` (including archive), delete project or column | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

---

## APIs

Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/projects` | Active cards + separate `templates`. `?status=archived\|active\|template`. Empty state `no_projects` \| `has_data` (active only) |
| POST | `/api/projects` | Staff+. Default columns unless `columns[]` is sent |
| GET / PATCH / DELETE | `/api/projects/:id` | Delete: owner/admin. PATCH `status`: owner/admin |
| POST | `/api/projects/:id/duplicate` | Always creates `status: active` with copied columns/tasks |
| POST | `/api/projects/:id/archive` | Owner/admin |
| POST | `/api/projects/:id/columns` | Add a column |
| PATCH / DELETE | `/api/project-columns/:id` | Delete blocked if tasks remain (`409 column_in_use`) or if it is the last column |
| POST | `/api/projects/:id/tasks` | `{ title, columnId?, notes?, dueDate?, assigneeName?, done? }` |
| PATCH / DELETE | `/api/project-tasks/:id` | Staff+ |
| POST | `/api/project-tasks/:id/move` | `{ columnId, sortOrder? }` |
| POST | `/api/project-tasks/:id/toggle` | `{ done? }` — flips if omitted |
| POST | `/api/ghl/webhook` | **501**. CRM ingress is out |

### Audit

List/read/create/update/delete/duplicate/move/toggle are audited (`resourceType`: `project`, `project_column`, `project_task`). Metadata holds **IDs, field names, counts, status** — never titles, notes, tags, assignee names, or search text.

---

## UI

- `/projects` — active cards with task counts and %; **Templates** section (dashed cards, Use template); New Project. Archived is a quiet toggle, not in the main grid.
- `/projects/:id` — board by column; add/edit/toggle/move tasks; progress. Template banner: duplicate to start live work.
- Empty states when there are no active projects.
- Nav: **Projects**.

---

## Encryption

`PHI_ENCRYPTION_KEY` (AES-256-GCM) covers project task notes in addition to existing patient / daily-log / goal / onboarding / care-plan fields. Storage callers always see plaintext. RDS encryption-at-rest is still required.

---

## Out of scope (this week)

Advanced Metrics, CSV import, emailed reports, GHL CRM webhook (stub only), new Stripe work, OpenAI, ChiroTouch.
