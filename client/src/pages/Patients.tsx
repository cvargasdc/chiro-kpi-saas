import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type Patient,
  type PatientsListResponse,
  type ReferralLeaderboardResponse,
  type ReferralSource,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };
type Tab = "all" | "new" | "wellness";

type FormState = {
  name: string;
  email: string;
  phone: string;
  patientType: "new" | "wellness";
  referralSource: string;
  day1Date: string;
  day2Date: string;
  careStatus: string;
  condition: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  phone: "",
  patientType: "new",
  referralSource: "",
  day1Date: "",
  day2Date: "",
  careStatus: "new",
  condition: "",
  notes: "",
};

function rateLabel(value: number | null): string {
  if (value == null) return "—";
  return `${value}%`;
}

export default function PatientsPage({ me, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [data, setData] = useState<PatientsListResponse | null>(null);
  const [board, setBoard] = useState<ReferralLeaderboardResponse | null>(null);
  const [sources, setSources] = useState<ReferralSource[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const leaderboardRange = useMemo(() => {
    if (!month || !board) return null;
    return { from: `${month}-01`, to: board.to };
  }, [month, board]);

  async function load(next: { tab?: Tab; q?: string; month?: string } = {}) {
    const type = next.tab ?? tab;
    const query = next.q ?? q;
    const monthVal = next.month ?? month;
    const params = new URLSearchParams();
    if (type !== "all") params.set("type", type);
    if (query.trim()) params.set("q", query.trim());
    if (monthVal) params.set("month", monthVal);
    const qs = params.toString();
    const list = await api<PatientsListResponse>(`/api/patients${qs ? `?${qs}` : ""}`);
    setData(list);

    const lbParams = new URLSearchParams();
    if (monthVal) {
      const [y, m] = monthVal.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      lbParams.set("from", `${monthVal}-01`);
      lbParams.set("to", last);
    }
    const lbQs = lbParams.toString();
    const lb = await api<ReferralLeaderboardResponse>(
      `/api/patients/referral-leaderboard${lbQs ? `?${lbQs}` : ""}`,
    );
    setBoard(lb);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load patients"),
    );
    api<{ sources: ReferralSource[] }>("/api/referral-sources")
      .then((body) => setSources(body.sources))
      .catch(() => setSources([]));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/api/patients", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          patientType: form.patientType,
          referralSource: form.referralSource.trim() || null,
          day1Date: form.day1Date || null,
          day2Date: form.day2Date || null,
          careStatus: form.careStatus,
          condition: form.condition.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      setForm(EMPTY_FORM);
      await load();
      const src = await api<{ sources: ReferralSource[] }>("/api/referral-sources");
      setSources(src.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create patient");
    } finally {
      setSaving(false);
    }
  }

  const emptyCopy =
    data?.emptyState === "no_patients"
      ? "No patients in this practice yet."
      : data?.emptyState === "no_matches"
        ? "No patients match these filters."
        : "";

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Patients</h2>
          <p className="text-sm text-ink-500">
            New vs wellness, referral conversion, Day 1 / Day 2, and care status.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {(["all", "new", "wellness"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                load({ tab: key }).catch((err) =>
                  setError(err instanceof Error ? err.message : "Filter failed"),
                );
              }}
              className={
                tab === key
                  ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 font-medium capitalize"
                  : "rounded-lg border border-slate-200 px-3 py-1.5 capitalize hover:bg-slate-50"
              }
            >
              {key === "all" ? "All" : key === "new" ? "New" : "Wellness"}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load().catch((err) =>
            setError(err instanceof Error ? err.message : "Search failed"),
          );
        }}
      >
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="block text-ink-500 mb-1">Search</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Name, email, phone, condition"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-ink-500 mb-1">Month</span>
          <input
            type="month"
            className="rounded-lg border border-slate-200 px-3 py-2"
            value={month}
            onChange={(e) => {
              const next = e.target.value;
              setMonth(next);
              load({ month: next }).catch((err) =>
                setError(err instanceof Error ? err.message : "Filter failed"),
              );
            }}
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {canWrite ? (
        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">Add patient</h3>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm sm:col-span-2">
              <span className="block text-ink-500 mb-1">Name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                maxLength={200}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Type</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.patientType}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    patientType: e.target.value as "new" | "wellness",
                  }))
                }
              >
                <option value="new">New</option>
                <option value="wellness">Wellness</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Email</span>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Phone</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Referral source</span>
              <input
                list="referral-sources"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.referralSource}
                onChange={(e) =>
                  setForm((p) => ({ ...p, referralSource: e.target.value }))
                }
                placeholder="Google, patient, walk-in…"
              />
              <datalist id="referral-sources">
                {sources.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Day 1</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.day1Date}
                onChange={(e) => setForm((p) => ({ ...p, day1Date: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Day 2</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.day2Date}
                onChange={(e) => setForm((p) => ({ ...p, day2Date: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Care status</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.careStatus}
                onChange={(e) => setForm((p) => ({ ...p, careStatus: e.target.value }))}
              >
                <option value="new">New</option>
                <option value="in_care">In care</option>
                <option value="wellness">Wellness</option>
                <option value="discharged">Discharged</option>
                <option value="lost">Lost</option>
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block text-ink-500 mb-1">Condition</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.condition}
                onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value }))}
              />
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">
              <span className="block text-ink-500 mb-1">Notes</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                maxLength={2000}
              />
            </label>
            <div>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Add patient"}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p className="text-sm text-ink-500">Read-only role — patient records cannot be changed.</p>
      )}

      <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Referral conversion</h3>
          <span className="text-xs text-ink-500">
            {board
              ? `${board.from} – ${board.to}`
              : leaderboardRange
                ? `${leaderboardRange.from} – ${leaderboardRange.to}`
                : ""}
          </span>
        </div>
        <p className="text-xs text-ink-500">
          Conversion = converted new patients / new patients in the period. Wellness is listed separately.
        </p>
        {!board || board.rows.length === 0 ? (
          <p className="text-sm text-ink-500">No referral activity in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Source</th>
                  <th className="py-2 pr-3 font-medium">New</th>
                  <th className="py-2 pr-3 font-medium">Converted</th>
                  <th className="py-2 pr-3 font-medium">Rate</th>
                  <th className="py-2 font-medium">Wellness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {board.rows.map((row) => (
                  <tr key={row.referralSource}>
                    <td className="py-2 pr-3 font-medium">{row.referralSource}</td>
                    <td className="py-2 pr-3">{row.newCount}</td>
                    <td className="py-2 pr-3">{row.convertedCount}</td>
                    <td className="py-2 pr-3">{rateLabel(row.conversionPercent)}</td>
                    <td className="py-2">{row.wellnessCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
        <h3 className="font-semibold">
          Directory
          {data ? (
            <span className="ml-2 text-sm font-normal text-ink-500">
              {data.page.total}
            </span>
          ) : null}
        </h3>
        {emptyCopy ? <p className="text-sm text-ink-500">{emptyCopy}</p> : null}
        {data && data.patients.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Referral</th>
                  <th className="py-2 pr-3 font-medium">Day 1</th>
                  <th className="py-2 pr-3 font-medium">Day 2</th>
                  <th className="py-2 pr-3 font-medium">Care</th>
                  <th className="py-2 font-medium">Converted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.patients.map((p) => (
                  <PatientRow key={p.id} patient={p} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function PatientRow({ patient }: { patient: Patient }) {
  return (
    <tr>
      <td className="py-2 pr-3">
        <Link href={`/patients/${patient.id}`} className="font-medium text-accent-600">
          {patient.name}
        </Link>
      </td>
      <td className="py-2 pr-3 capitalize">{patient.patientType}</td>
      <td className="py-2 pr-3">{patient.referralSource ?? "—"}</td>
      <td className="py-2 pr-3">{patient.day1Date ?? "—"}</td>
      <td className="py-2 pr-3">{patient.day2Date ?? "—"}</td>
      <td className="py-2 pr-3">{patient.careStatus.replace("_", " ")}</td>
      <td className="py-2">{patient.converted ? "Yes" : "No"}</td>
    </tr>
  );
}
