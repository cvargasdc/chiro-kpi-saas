# Week 10 — Practice Checklists + Patient Onboarding (parity chunk 5)

Path B isolation (`org_id` + `practice_id` on tenant rows) is unchanged. No OpenAI. No ChiroTouch parsers. Stripe checkout/portal/webhooks are **untouched**. Live Replit / chiro-kpi.com was not touched.

This week ports two **different** legacy features that were easy to confuse: clinic ops checklists vs patient onboarding checklists. They stay on separate routes, tables, and nav items.

---

## The difference (do not mix)

| | **Practice Checklists** | **Patient Onboarding** |
|--|-------------------------|------------------------|
| Who it is for | The clinic (front desk, opening/closing, weekly ops) | A named patient |
| Route | `/practice-checklists` | `/onboarding` |
| Nav label | Checklists | Onboarding |
| Tables | `practice_checklists`, `practice_checklist_items`, `practice_checklist_completions` | `checklist_templates`, `checklist_template_tasks`, `patient_checklists`, `patient_checklist_tasks` |
| Cadence / type | `daily` or `weekly` | Template `patientType`: `new` \| `wellness` \| `all` |
| “New Template” | **Does not exist here.** Manage tab creates a **checklist** (ops list) | **Templates tab only.** Patient Checklists tab assigns an existing template |
| PHI | Ops text. Completions are workforce activity. | Tied to `patientId`. Notes are ePHI (encrypted). Task titles may describe care — never put names or notes in audit metadata |

Legacy IA used `/checklists` for onboarding and `/practice-checklists` for ops. This rebuild keeps **Onboarding** at `/onboarding` so “checklist” in the nav means clinic ops.

`patient_intakes` remains a reserved table. It is still not the onboarding API.

---

## Practice Checklists

### Data model

No `"default"` `practiceId`. Child rows also carry `org_id` + `practice_id`.

| Table | Rules |
|-------|--------|
| `practice_checklists` | `name`, `cadence` (`daily` \| `weekly`), `active` |
| `practice_checklist_items` | `checklistId`, `title`, `category`, `sortOrder`, `active` |
| `practice_checklist_completions` | `itemId`, `completedOn` (date), `completedBy`, `completed`. Unique `(practice_id, item_id, completed_on)` |

**Canonical completion date**

- Daily items: the calendar date (UTC `YYYY-MM-DD`).
- Weekly items: Monday of the UTC ISO week containing the requested date. Toggling on Wednesday still stores Monday.

Today view includes active items from active checklists. Progress is `done/total` for that date (or that week for weekly items).

### RBAC

| Action | Roles |
|--------|--------|
| List / today / history / read | `owner`, `admin`, `clinician`, `staff`, `readonly` |
| Create / update / toggle completion | `owner`, `admin`, `clinician`, `staff` (`PHI_WRITE_ROLES`). `readonly` is blocked |
| Delete checklists or items | `owner`, `admin` (`PHI_DELETE_ROLES`) |

Writes also pass the existing billing entitlement gate (no-op unless `BILLING_ENFORCE=true`). No new Stripe work.

### APIs

Tenant comes from the session (or `X-Practice-Id` **after** membership is proven).

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/practice-checklists/today` | Optional `date=YYYY-MM-DD` (default today). Progress X/Y + completion state |
| GET | `/api/practice-checklists/history` | Default last 14 days. `from`/`to` max 366 days |
| GET | `/api/practice-checklists` | Manage payload (lists + items) |
| POST | `/api/practice-checklists` | Create. Staff+ |
| GET / PATCH / DELETE | `/api/practice-checklists/:id` | Delete: owner/admin |
| POST | `/api/practice-checklists/:id/items` | Add item |
| PATCH / DELETE | `/api/practice-checklist-items/:id` | Delete: owner/admin |
| POST | `/api/practice-checklist-items/:id/toggle` | `{ date? \| completedOn?, completed? }`. Default date = today. Flips if `completed` omitted |

Empty states: `no_checklists`, `no_items`, `has_data`.

Audit `resourceType`: `practice_checklist`, `practice_checklist_item`, `practice_checklist_completion`. Metadata holds IDs, cadence, counts, dates — never free-text titles.

### UI

`/practice-checklists` — tabs **Today** / **History** / **Manage**. Progress `X/Y`. Empty copy when there are no lists or no items. New checklist lives on **Manage**, not Today.

---

## Patient Onboarding

### Data model

| Table | Rules |
|-------|--------|
| `checklist_templates` | `name`, `patientType` (`new` \| `wellness` \| `all`), `active` |
| `checklist_template_tasks` | `templateId`, `title`, `description`, `sortOrder` |
| `patient_checklists` | `patientId`, `templateId`, `templateName` (snapshot), `status`, `notes` (AES-256-GCM) |
| `patient_checklist_tasks` | Copied from the template at assign time. `done`, optional `assigneeName`, `notes` encrypted, `completedAt` |

Assigning a template **creates** a `patient_checklists` row and copies each template task into `patient_checklist_tasks`. Later edits to the template do not rewrite in-flight patient instances.

Status is derived from tasks and stored:

- no tasks or none done → `not_started`
- some done → `in_progress`
- all done → `complete`

Deleting a template is blocked (`409 template_in_use`) while any patient checklist still points at it. Deactivating is the soft path.

### RBAC

| Action | Roles |
|--------|--------|
| List / read templates and patient checklists, progress | all practice roles including `readonly` |
| Template CRUD (including template delete) | `owner`, `admin`, `clinician`, `staff` |
| Assign template, toggle tasks, patch notes | staff+ |
| Delete a patient’s onboarding instance | `owner`, `admin` |

### APIs

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/onboarding/templates` | Includes tasks |
| POST | `/api/onboarding/templates` | Optional `tasks[]` created in the same request |
| GET / PATCH / DELETE | `/api/onboarding/templates/:id` | Delete blocked if assigned |
| POST | `/api/onboarding/templates/:id/tasks` | Add a template task |
| PATCH / DELETE | `/api/onboarding/template-tasks/:id` | |
| GET | `/api/onboarding/patient-checklists` | Optional `patientId` |
| POST | `/api/onboarding/patient-checklists` | `{ patientId, templateId, notes? }` → copies tasks |
| GET / PATCH / DELETE | `/api/onboarding/patient-checklists/:id` | |
| POST | `/api/onboarding/patient-checklists/:id/tasks/:taskId/toggle` | `{ done?, assigneeName?, notes? }` |
| GET | `/api/onboarding/progress` | Incomplete / complete counts. No names |

`GET /api/patients/:id` includes:

```json
"onboarding": {
  "available": true,
  "assigned": true,
  "checklists": [
    { "id": "…", "templateId": "…", "templateName": "Day-1", "status": "in_progress", "doneCount": 1, "totalCount": 3 }
  ]
}
```

When nothing is assigned: `assigned: false` and an honest reason string. List responses include the same summary.

Audit `resourceType`: `checklist_template`, `checklist_template_task`, `patient_checklist`, `patient_checklist_task`. Metadata holds IDs, field names, counts, `done` booleans — **never patient names, search strings, or note text**.

### UI

- `/onboarding` — **Templates** tab (New Template lives here) and **Patient Checklists** tab (assign + progress). No New Template on the patient tab.
- `/patients/:id` — onboarding status if assigned, plus a link to `/onboarding?patientId=…`.

---

## Dashboard widget

`GET /api/dashboard` includes:

```json
"onboarding": {
  "available": true,
  "assignedCount": 0,
  "incompleteCount": 0,
  "completeCount": 0,
  "emptyState": "no_assignments"
}
```

`emptyState` is `no_assignments` | `all_complete` | `has_incomplete`. Zero assignments is an honest empty (incomplete count 0), not a fake backlog.

---

## Encryption

`PHI_ENCRYPTION_KEY` (AES-256-GCM) covers `patient_checklists.notes` and `patient_checklist_tasks.notes` in addition to existing patient / daily-log / goal notes. Storage callers always see plaintext. RDS encryption-at-rest is still required.

---

## Out of scope (this week)

Care Plan Generator, Projects, Advanced Metrics, CSV import, emailed reports, new Stripe work, OpenAI, ChiroTouch.
