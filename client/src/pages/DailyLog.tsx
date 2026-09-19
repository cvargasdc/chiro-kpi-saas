import { FormEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type DailyLogEntry,
  type DailyLogListResponse,
  type DailyLogMutationResponse,
  type MeResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function emptyCopy(state: DailyLogListResponse["emptyState"]): string {
  if (state === "no_entries") return "No daily log entries in this range yet.";
  if (state === "zeros_recorded") {
    return "Days were logged, but visits and revenue are all zero.";
  }
  return "";
}

export default function DailyLogPage({ me, onLogout }: Props) {
  const canWrite = me.active?.role && me.active.role !== "readonly";
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [data, setData] = useState<DailyLogListResponse | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [form, setForm] = useState({
    date: "",
    visits: "0",
    revenue: "0",
    notes: "",
  });
  const [editingExisting, setEditingExisting] = useState(false);
  const [saving, setSaving] = useState(false);

  const todayEntry = useMemo(
    () => data?.entries.find((row) => row.date === data.today) ?? null,
    [data],
  );

  async function load(range?: { from: string; to: string }) {
    const params = new URLSearchParams();
    const fromVal = range?.from ?? from;
    const toVal = range?.to ?? to;
    if (fromVal) params.set("from", fromVal);
    if (toVal) params.set("to", toVal);
    const qs = params.toString();
    const body = await api<DailyLogListResponse>(
      `/api/daily-log${qs ? `?${qs}` : ""}`,
    );
    setData(body);
    if (!fromVal && !toVal) {
      setFrom(body.from);
      setTo(body.to);
    }
    setForm((prev) => {
      if (prev.date) return prev;
      const existing = body.entries.find((row) => row.date === body.today);
      return {
        date: body.today,
        visits: existing ? String(existing.visits) : "0",
        revenue: existing ? String(existing.revenue) : "0",
        notes: existing?.notes ?? "",
      };
    });
    setEditingExisting(Boolean(body.entries.find((row) => row.date === body.today)));
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load daily log"),
    );
  }, []);

  function fillForm(row: DailyLogEntry) {
    setForm({
      date: row.date,
      visits: String(row.visits),
      revenue: String(row.revenue),
      notes: row.notes ?? "",
    });
    setEditingExisting(true);
    setError("");
  }

  function resetToToday() {
    const today = data?.today ?? form.date;
    const existing = data?.entries.find((row) => row.date === today);
    setForm({
      date: today,
      visits: existing ? String(existing.visits) : "0",
      revenue: existing ? String(existing.revenue) : "0",
      notes: existing?.notes ?? "",
    });
    setEditingExisting(Boolean(existing));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const visits = Number(form.visits);
      const revenue = Number(form.revenue);
      if (!Number.isInteger(visits) || visits < 0) {
        throw new Error("Visits must be a whole number ≥ 0");
      }
      if (!Number.isFinite(revenue) || revenue < 0) {
        throw new Error("Revenue must be ≥ 0");
      }
      const payload = {
        visits,
        revenue,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
      const exists = data?.entries.some((row) => row.date === form.date);
      if (exists) {
        await api<DailyLogMutationResponse>(`/api/daily-log/${form.date}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api<DailyLogMutationResponse>("/api/daily-log", {
          method: "POST",
          body: JSON.stringify({ date: form.date, ...payload }),
        });
      }
      await load({ from, to });
      setEditingExisting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(date: string) {
    if (!confirm(`Delete the daily log for ${date}?`)) return;
    setError("");
    try {
      await api(`/api/daily-log/${date}`, { method: "DELETE" });
      if (form.date === date) {
        setForm({ date, visits: "0", revenue: "0", notes: "" });
        setEditingExisting(false);
      }
      await load({ from, to });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const warnings = data?.warnings ?? [];

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Daily Log</h2>
          <p className="text-sm text-ink-500">
            One row per calendar day. Revenue is stored as integer cents.
          </p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            load({ from, to }).catch((err) =>
              setError(err instanceof Error ? err.message : "Filter failed"),
            );
          }}
        >
          <label className="text-sm">
            <span className="block text-ink-500 mb-1">From</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-ink-500 mb-1">To</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
          >
            Filter
          </button>
        </form>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {warnings.length} day{warnings.length === 1 ? "" : "s"} have revenue
          with zero visits. The rows were saved — confirm they are not typos.
        </div>
      ) : null}

      {canWrite ? (
        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">
              {editingExisting ? "Edit entry" : "Add entry"}
            </h3>
            <button
              type="button"
              onClick={resetToToday}
              className="text-sm text-accent-600 font-medium"
            >
              Use today{data?.today ? ` (${data.today})` : ""}
            </button>
          </div>
          {todayEntry && form.date === data?.today ? (
            <p className="text-sm text-ink-500">
              Today already has an entry. Saving will update it.
            </p>
          ) : null}
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Date</span>
              <input
                type="date"
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.date}
                onChange={(e) => {
                  const date = e.target.value;
                  const existing = data?.entries.find((row) => row.date === date);
                  setForm({
                    date,
                    visits: existing ? String(existing.visits) : "0",
                    revenue: existing ? String(existing.revenue) : "0",
                    notes: existing?.notes ?? "",
                  });
                  setEditingExisting(Boolean(existing));
                }}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Visits</span>
              <input
                type="number"
                min={0}
                step={1}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.visits}
                onChange={(e) => setForm((prev) => ({ ...prev, visits: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Revenue (USD)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.revenue}
                onChange={(e) => setForm((prev) => ({ ...prev, revenue: e.target.value }))}
              />
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-4">
              <span className="block text-ink-500 mb-1">Notes (optional, treated as PHI)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                maxLength={2000}
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </label>
            <div>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600 disabled:opacity-50"
              >
                {saving ? "Saving…" : editingExisting ? "Update" : "Save"}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p className="text-sm text-ink-500">Read-only role — daily log cannot be changed.</p>
      )}

      <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
        <h3 className="font-semibold">Entries</h3>
        {!data ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : data.entries.length === 0 ? (
          <p className="text-sm text-ink-500">{emptyCopy(data.emptyState)}</p>
        ) : (
          <>
            {data.emptyState === "zeros_recorded" ? (
              <p className="text-sm text-ink-500">{emptyCopy(data.emptyState)}</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-500 border-b border-slate-100">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Visits</th>
                    <th className="py-2 pr-3 font-medium">Revenue</th>
                    <th className="py-2 pr-3 font-medium">Notes</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{row.date}</td>
                      <td className="py-2 pr-3">{row.visits}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{money(row.revenue)}</td>
                      <td className="py-2 pr-3 max-w-xs truncate" title={row.notes ?? ""}>
                        {row.notes || "—"}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        {canWrite ? (
                          <button
                            type="button"
                            className="text-accent-600 font-medium mr-3"
                            onClick={() => fillForm(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="text-red-700 font-medium"
                            onClick={() => onDelete(row.date)}
                          >
                            Delete
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
