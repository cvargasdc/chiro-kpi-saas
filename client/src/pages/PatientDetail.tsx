import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import AppShell from "../components/AppShell";
import { api, type MeResponse, type Patient, type ReferralSource } from "../lib/api";

type Props = {
  me: MeResponse;
  patientId: string;
  onLogout: () => void;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  patientType: "new" | "wellness";
  referralSource: string;
  day1Date: string;
  day2Date: string;
  careStatus: string;
  converted: boolean;
  conversionDate: string;
  planType: string;
  condition: string;
  status: "active" | "inactive";
  notes: string;
};

function toForm(p: Patient): FormState {
  return {
    name: p.name,
    email: p.email ?? "",
    phone: p.phone ?? "",
    dateOfBirth: p.dateOfBirth ?? "",
    patientType: p.patientType === "wellness" ? "wellness" : "new",
    referralSource: p.referralSource ?? "",
    day1Date: p.day1Date ?? "",
    day2Date: p.day2Date ?? "",
    careStatus: p.careStatus,
    converted: p.converted,
    conversionDate: p.conversionDate ?? "",
    planType: p.planType ?? "",
    condition: p.condition ?? "",
    status: p.status === "inactive" ? "inactive" : "active",
    notes: p.notes ?? "",
  };
}

export default function PatientDetailPage({ me, patientId, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [, setLocation] = useLocation();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [sources, setSources] = useState<ReferralSource[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const body = await api<{ patient: Patient }>(`/api/patients/${patientId}`);
    setPatient(body.patient);
    setForm(toForm(body.patient));
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load patient"),
    );
    api<{ sources: ReferralSource[] }>("/api/referral-sources")
      .then((body) => setSources(body.sources))
      .catch(() => setSources([]));
  }, [patientId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError("");
    setSaving(true);
    try {
      await api(`/api/patients/${patientId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          dateOfBirth: form.dateOfBirth || null,
          patientType: form.patientType,
          referralSource: form.referralSource.trim() || null,
          day1Date: form.day1Date || null,
          day2Date: form.day2Date || null,
          careStatus: form.careStatus,
          converted: form.converted,
          conversionDate: form.conversionDate || null,
          planType: form.planType.trim() || null,
          condition: form.condition.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleConverted() {
    if (!form) return;
    setError("");
    try {
      await api(`/api/patients/${patientId}/conversion`, {
        method: "POST",
        body: JSON.stringify({ converted: !form.converted }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion update failed");
    }
  }

  async function onDelete() {
    if (!patient) return;
    if (!confirm(`Delete patient “${patient.name}”? This cannot be undone.`)) return;
    setError("");
    try {
      await api(`/api/patients/${patientId}`, { method: "DELETE" });
      setLocation("/patients");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm">
            <Link href="/patients" className="text-accent-600 font-medium">
              ← Patients
            </Link>
          </p>
          <h2 className="text-2xl font-semibold">{patient?.name ?? "Patient"}</h2>
          <p className="text-sm text-ink-500">
            Conversion, care status, and notes. Checklists are not in this release.
          </p>
        </div>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-200 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
          >
            Delete
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {!form ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-6">
          <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Identity</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <input
                  required
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Record status">
                <select
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as "active" | "inactive" })
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <Field label="Date of birth">
                <input
                  type="date"
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                />
              </Field>
              <Field label="Condition">
                <input
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.condition}
                  onChange={(e) => setForm({ ...form, condition: e.target.value })}
                />
              </Field>
            </div>
          </section>

          <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Funnel</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <select
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.patientType}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      patientType: e.target.value as "new" | "wellness",
                    })
                  }
                >
                  <option value="new">New</option>
                  <option value="wellness">Wellness</option>
                </select>
              </Field>
              <Field label="Referral source">
                <input
                  list="detail-referral-sources"
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.referralSource}
                  onChange={(e) => setForm({ ...form, referralSource: e.target.value })}
                />
                <datalist id="detail-referral-sources">
                  {sources.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Day 1">
                <input
                  type="date"
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.day1Date}
                  onChange={(e) => setForm({ ...form, day1Date: e.target.value })}
                />
              </Field>
              <Field label="Day 2">
                <input
                  type="date"
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.day2Date}
                  onChange={(e) => setForm({ ...form, day2Date: e.target.value })}
                />
              </Field>
              <Field label="Care status">
                <select
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.careStatus}
                  onChange={(e) => setForm({ ...form, careStatus: e.target.value })}
                >
                  <option value="new">New</option>
                  <option value="in_care">In care</option>
                  <option value="wellness">Wellness</option>
                  <option value="discharged">Discharged</option>
                  <option value="lost">Lost</option>
                </select>
              </Field>
              <Field label="Plan type">
                <input
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.planType}
                  onChange={(e) => setForm({ ...form, planType: e.target.value })}
                />
              </Field>
              <Field label="Conversion date">
                <input
                  type="date"
                  disabled={!canWrite}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.conversionDate}
                  onChange={(e) => setForm({ ...form, conversionDate: e.target.value })}
                />
              </Field>
              <div className="flex items-end gap-3">
                <span
                  className={
                    form.converted
                      ? "text-xs rounded-full bg-emerald-100 text-emerald-800 px-2 py-1 font-medium"
                      : "text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-1 font-medium"
                  }
                >
                  {form.converted ? "Converted" : "Not converted"}
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={toggleConverted}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    {form.converted ? "Mark not converted" : "Mark converted"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Notes</h3>
            <textarea
              disabled={!canWrite}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 min-h-[8rem]"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={2000}
            />
            <p className="text-xs text-ink-500">
              Free-text notes are encrypted at rest. Do not put names in audit metadata — the
              API already follows that rule.
            </p>
          </section>

          <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">Onboarding</h3>
              <Link
                href={`/onboarding?patientId=${patientId}`}
                className="text-sm text-accent-600 font-medium"
              >
                {patient?.onboarding.assigned
                  ? "View onboarding"
                  : "Assign onboarding"}
              </Link>
            </div>
            {patient?.onboarding.assigned ? (
              <ul className="text-sm space-y-1">
                {patient.onboarding.checklists.map((row) => (
                  <li key={row.id}>
                    {row.templateName} · {row.status} · {row.doneCount}/
                    {row.totalCount}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">
                {patient?.onboarding.reason ??
                  "No onboarding checklist assigned yet."}
              </p>
            )}
          </section>

          {canWrite ? (
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          ) : (
            <p className="text-sm text-ink-500">Read-only role — this profile cannot be edited.</p>
          )}
        </form>
      )}
    </AppShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="text-sm">
      <span className="block text-ink-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
