import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type OnboardingTemplate,
  type OnboardingTemplatesResponse,
  type Patient,
  type PatientChecklist,
  type PatientChecklistsResponse,
  type PatientsListResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };
type Tab = "templates" | "patients";

export default function OnboardingPage({ me, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const preselectedPatient = params.get("patientId") ?? "";
  const [tab, setTab] = useState<Tab>(
    preselectedPatient ? "patients" : "templates",
  );
  const [templates, setTemplates] = useState<OnboardingTemplatesResponse | null>(
    null,
  );
  const [assigned, setAssigned] = useState<PatientChecklistsResponse | null>(
    null,
  );
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateType, setTemplateType] = useState<"new" | "wellness" | "all">(
    "all",
  );
  const [taskTitles, setTaskTitles] = useState("");
  const [assignPatientId, setAssignPatientId] = useState(preselectedPatient);
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [selected, setSelected] = useState<PatientChecklist | null>(null);

  async function loadTemplates() {
    const body = await api<OnboardingTemplatesResponse>(
      "/api/onboarding/templates",
    );
    setTemplates(body);
    if (!assignTemplateId && body.templates[0]) {
      setAssignTemplateId(body.templates[0].id);
    }
  }

  async function loadAssigned(patientId?: string) {
    const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}` : "";
    const body = await api<PatientChecklistsResponse>(
      `/api/onboarding/patient-checklists${qs}`,
    );
    setAssigned(body);
  }

  async function loadPatients() {
    const body = await api<PatientsListResponse>("/api/patients?limit=200");
    setPatients(body.patients);
  }

  useEffect(() => {
    loadTemplates().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load templates"),
    );
    loadAssigned(preselectedPatient || undefined).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load checklists"),
    );
    loadPatients().catch(() => setPatients([]));
  }, []);

  function switchTab(next: Tab) {
    setTab(next);
    setError("");
    setSelected(null);
  }

  async function createTemplate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const tasks = taskTitles
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((title, sortOrder) => ({ title, sortOrder }));
      await api("/api/onboarding/templates", {
        method: "POST",
        body: JSON.stringify({
          name: templateName.trim(),
          patientType: templateType,
          tasks,
        }),
      });
      setTemplateName("");
      setTaskTitles("");
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(row: OnboardingTemplate) {
    if (!confirm(`Delete template “${row.name}”?`)) return;
    setError("");
    try {
      await api(`/api/onboarding/templates/${row.id}`, { method: "DELETE" });
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function assignTemplate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/api/onboarding/patient-checklists", {
        method: "POST",
        body: JSON.stringify({
          patientId: assignPatientId,
          templateId: assignTemplateId,
        }),
      });
      await loadAssigned(assignPatientId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(checklist: PatientChecklist, taskId: string, done: boolean) {
    if (!canWrite) return;
    setError("");
    try {
      const body = await api<{ checklist: PatientChecklist }>(
        `/api/onboarding/patient-checklists/${checklist.id}/tasks/${taskId}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({ done: !done }),
        },
      );
      setSelected(body.checklist);
      await loadAssigned(assignPatientId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  const patientName = (id: string) =>
    patients.find((p) => p.id === id)?.name ?? "Patient";

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div>
        <h2 className="text-2xl font-semibold">Patient Onboarding</h2>
        <p className="text-sm text-ink-500">
          Templates and per-patient progress. Clinic daily/weekly ops live on
          Checklists — New Template only appears here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => switchTab("templates")}
          className={
            tab === "templates"
              ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 text-sm font-medium"
              : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          }
        >
          Templates
        </button>
        <button
          type="button"
          onClick={() => switchTab("patients")}
          className={
            tab === "patients"
              ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 text-sm font-medium"
              : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          }
        >
          Patient Checklists
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {tab === "templates" ? (
        <div className="space-y-6">
          {canWrite ? (
            <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
              <h3 className="font-semibold">New Template</h3>
              <form onSubmit={createTemplate} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="block text-ink-500 mb-1">Name</span>
                    <input
                      required
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      maxLength={200}
                      placeholder="e.g. New patient Day-1"
                    />
                  </label>
                  <label className="text-sm">
                    <span className="block text-ink-500 mb-1">Patient type</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={templateType}
                      onChange={(e) =>
                        setTemplateType(
                          e.target.value as "new" | "wellness" | "all",
                        )
                      }
                    >
                      <option value="all">All</option>
                      <option value="new">New</option>
                      <option value="wellness">Wellness</option>
                    </select>
                  </label>
                </div>
                <label className="text-sm block">
                  <span className="block text-ink-500 mb-1">
                    Tasks (one per line)
                  </span>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 min-h-[6rem]"
                    value={taskTitles}
                    onChange={(e) => setTaskTitles(e.target.value)}
                    placeholder={"Intake forms\nExam\nCare plan walkthrough"}
                  />
                </label>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Create template"}
                </button>
              </form>
            </section>
          ) : null}

          {templates?.emptyState === "no_templates" ? (
            <p className="text-sm text-ink-500">
              No onboarding templates yet. Create one to assign to patients.
            </p>
          ) : null}

          {templates?.templates.map((row) => (
            <section
              key={row.id}
              className="bg-white shadow-card rounded-2xl p-6 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{row.name}</h3>
                  <p className="text-sm text-ink-500">
                    {row.patientType} · {row.active ? "active" : "inactive"} ·{" "}
                    {row.taskCount} tasks
                  </p>
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => deleteTemplate(row)}
                    className="rounded-lg border border-red-200 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <ol className="list-decimal list-inside text-sm space-y-1">
                {row.tasks.map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "patients" ? (
        <div className="space-y-6">
          {canWrite ? (
            <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
              <h3 className="font-semibold">Assign template to patient</h3>
              <form
                onSubmit={assignTemplate}
                className="grid gap-3 sm:grid-cols-3"
              >
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Patient</span>
                  <select
                    required
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={assignPatientId}
                    onChange={(e) => setAssignPatientId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Template</span>
                  <select
                    required
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={assignTemplateId}
                    onChange={(e) => setAssignTemplateId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {templates?.templates
                      .filter((t) => t.active)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
                  >
                    Assign
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {assigned?.emptyState === "no_checklists" ? (
            <p className="text-sm text-ink-500">
              No patient onboarding checklists assigned yet.
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <ul className="bg-white shadow-card rounded-2xl divide-y divide-slate-100">
              {assigned?.checklists.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3 hover:bg-slate-50"
                    onClick={() => setSelected(row)}
                  >
                    <p className="font-medium text-sm">
                      {patientName(row.patientId)}
                    </p>
                    <p className="text-xs text-ink-500">
                      {row.templateName} · {row.status} · {row.doneCount}/
                      {row.totalCount}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{selected.templateName}</h3>
                    <p className="text-sm text-ink-500">
                      <Link
                        href={`/patients/${selected.patientId}`}
                        className="text-accent-600 font-medium"
                      >
                        {patientName(selected.patientId)}
                      </Link>{" "}
                      · {selected.status} · {selected.doneCount}/
                      {selected.totalCount}
                    </p>
                  </div>
                  {canDelete ? (
                    <button
                      type="button"
                      className="text-sm text-red-700"
                      onClick={async () => {
                        if (!confirm("Remove this onboarding checklist?")) return;
                        await api(
                          `/api/onboarding/patient-checklists/${selected.id}`,
                          { method: "DELETE" },
                        );
                        setSelected(null);
                        await loadAssigned(assignPatientId || undefined);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <ul className="space-y-2">
                  {selected.tasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={task.done}
                        disabled={!canWrite}
                        onChange={() => toggleTask(selected, task.id, task.done)}
                      />
                      <span className={task.done ? "line-through text-ink-500" : ""}>
                        {task.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="text-sm text-ink-500">
                Select a patient checklist to view progress.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
