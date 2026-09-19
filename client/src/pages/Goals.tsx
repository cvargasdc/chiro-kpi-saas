import { FormEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type GoalMutationResponse,
  type GoalsListResponse,
  type MeResponse,
  type PublicGoal,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

type MetricType = "revenue" | "visits" | "custom";
type TimePeriod = "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

type FormState = {
  name: string;
  metricType: MetricType;
  timePeriod: TimePeriod;
  target: string;
  current: string;
  startDate: string;
  endDate: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  metricType: "revenue",
  timePeriod: "monthly",
  target: "",
  current: "0",
  startDate: "",
  endDate: "",
  notes: "",
};

function addUtcDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function lastDayOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function startOfIsoWeekMonday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return addUtcDays(ymd, -offset);
}

function periodRange(period: TimePeriod, today: string): { startDate: string; endDate: string } {
  if (period === "weekly") {
    const startDate = startOfIsoWeekMonday(today);
    return { startDate, endDate: addUtcDays(startDate, 6) };
  }
  if (period === "monthly") {
    const startDate = `${today.slice(0, 7)}-01`;
    return { startDate, endDate: lastDayOfMonth(today) };
  }
  if (period === "quarterly") {
    const month = Number(today.slice(5, 7));
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const startDate = `${today.slice(0, 4)}-${String(quarterStartMonth).padStart(2, "0")}-01`;
    const endMonth = quarterStartMonth + 2;
    const endProbe = `${today.slice(0, 4)}-${String(endMonth).padStart(2, "0")}-01`;
    return { startDate, endDate: lastDayOfMonth(endProbe) };
  }
  if (period === "yearly") {
    const year = today.slice(0, 4);
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  return { startDate: today, endDate: today };
}

function statusChipClass(status: PublicGoal["status"]): string {
  switch (status) {
    case "achieved":
      return "bg-emerald-100 text-emerald-800";
    case "on_pace":
      return "bg-clinical-100 text-clinical-700";
    case "behind_pace":
      return "bg-amber-100 text-amber-900";
    case "below_target":
      return "bg-orange-100 text-orange-900";
    case "expired":
      return "bg-slate-200 text-slate-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function barClass(status: PublicGoal["status"]): string {
  switch (status) {
    case "achieved":
      return "bg-emerald-600";
    case "on_pace":
      return "bg-accent-500";
    case "behind_pace":
      return "bg-amber-500";
    case "below_target":
      return "bg-orange-500";
    default:
      return "bg-slate-400";
  }
}

function metricLabel(type: PublicGoal["metricType"]): string {
  if (type === "revenue") return "Revenue";
  if (type === "visits") return "Visits";
  return "Custom";
}

export default function GoalsPage({ me, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [data, setData] = useState<GoalsListResponse | null>(null);
  const [error, setError] = useState("");
  const [includeExpired, setIncludeExpired] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const today = data?.today ?? "";

  async function load(nextInclude = includeExpired) {
    const qs = nextInclude ? "?includeExpired=true" : "";
    const body = await api<GoalsListResponse>(`/api/goals${qs}`);
    setData(body);
    setForm((prev) => {
      if (prev.startDate || prev.endDate || editingId) return prev;
      const range = periodRange(prev.timePeriod, body.today);
      return { ...prev, ...range };
    });
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load goals"),
    );
  }, []);

  function resetForm(nextToday = today) {
    const range = periodRange("monthly", nextToday || form.startDate);
    setForm({ ...EMPTY_FORM, ...range });
    setEditingId(null);
  }

  function fillForm(goal: PublicGoal) {
    setForm({
      name: goal.name,
      metricType: goal.metricType,
      timePeriod: (["weekly", "monthly", "quarterly", "yearly", "custom"].includes(
        goal.timePeriod,
      )
        ? goal.timePeriod
        : "custom") as TimePeriod,
      target: String(goal.target),
      current: String(goal.metricType === "custom" ? goal.current : 0),
      startDate: goal.startDate,
      endDate: goal.endDate,
      notes: goal.notes ?? "",
    });
    setEditingId(goal.id);
    setError("");
  }

  function onPeriodChange(period: TimePeriod) {
    const range = period === "custom" ? { startDate: form.startDate, endDate: form.endDate } : periodRange(period, today || form.startDate);
    setForm((prev) => ({ ...prev, timePeriod: period, ...range }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const target = Number(form.target);
      if (!Number.isFinite(target) || target <= 0) {
        throw new Error("Target must be greater than zero");
      }
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        metricType: form.metricType,
        timePeriod: form.timePeriod,
        startDate: form.startDate,
        endDate: form.endDate,
        notes: form.notes.trim() ? form.notes.trim() : null,
      };
      if (form.metricType === "revenue") {
        payload.target = target;
      } else {
        if (!Number.isInteger(target)) {
          throw new Error("Target must be a whole number");
        }
        payload.targetValue = target;
      }
      if (form.metricType === "custom") {
        const current = Number(form.current);
        if (!Number.isInteger(current) || current < 0) {
          throw new Error("Current must be a whole number ≥ 0");
        }
        payload.currentValue = current;
      }
      if (editingId) {
        await api<GoalMutationResponse>(`/api/goals/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api<GoalMutationResponse>("/api/goals", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await load();
      resetForm(today);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete goal “${name}”?`)) return;
    setError("");
    try {
      await api(`/api/goals/${id}`, { method: "DELETE" });
      if (editingId === id) resetForm(today);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const alerts = useMemo(
    () =>
      (data?.goals ?? []).filter(
        (g) => g.status === "behind_pace" || g.status === "below_target",
      ),
    [data],
  );

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Goals</h2>
          <p className="text-sm text-ink-500">
            Revenue and visits track the daily log. Custom goals use a manual current value.
          </p>
        </div>
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeExpired}
            onChange={(e) => {
              const next = e.target.checked;
              setIncludeExpired(next);
              load(next).catch((err) =>
                setError(err instanceof Error ? err.message : "Filter failed"),
              );
            }}
          />
          Show expired
          {data && data.expiredCount > 0 ? (
            <span className="text-ink-500">({data.expiredCount})</span>
          ) : null}
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {alerts.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {alerts.length} goal{alerts.length === 1 ? "" : "s"} behind pace or below target.
        </div>
      ) : null}

      {canWrite ? (
        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">{editingId ? "Edit goal" : "Add goal"}</h3>
            {editingId ? (
              <button
                type="button"
                onClick={() => resetForm(today)}
                className="text-sm text-accent-600 font-medium"
              >
                Cancel edit
              </button>
            ) : null}
          </div>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm sm:col-span-2">
              <span className="block text-ink-500 mb-1">Name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                maxLength={200}
                placeholder="e.g. September collections"
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Metric</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.metricType}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, metricType: e.target.value as MetricType }))
                }
              >
                <option value="revenue">Revenue</option>
                <option value="visits">Visits</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">
                Target{form.metricType === "revenue" ? " (USD)" : ""}
              </span>
              <input
                required
                type="number"
                min={form.metricType === "revenue" ? "0.01" : "1"}
                step={form.metricType === "revenue" ? "0.01" : "1"}
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.target}
                onChange={(e) => setForm((prev) => ({ ...prev, target: e.target.value }))}
              />
            </label>
            {form.metricType === "custom" ? (
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">Current (manual)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.current}
                  onChange={(e) => setForm((prev) => ({ ...prev, current: e.target.value }))}
                />
              </label>
            ) : (
              <p className="text-sm text-ink-500 self-end pb-2">
                Current is summed from the daily log.
              </p>
            )}
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Period preset</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.timePeriod}
                onChange={(e) => onPeriodChange(e.target.value as TimePeriod)}
              >
                <option value="weekly">This week (Mon–Sun, UTC)</option>
                <option value="monthly">This month</option>
                <option value="quarterly">This quarter</option>
                <option value="yearly">This year</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Start</span>
              <input
                type="date"
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.startDate}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    startDate: e.target.value,
                    timePeriod: "custom",
                  }))
                }
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">End</span>
              <input
                type="date"
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.endDate}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    endDate: e.target.value,
                    timePeriod: "custom",
                  }))
                }
              />
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">
              <span className="block text-ink-500 mb-1">Notes (optional)</span>
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
                {saving ? "Saving…" : editingId ? "Update" : "Save"}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p className="text-sm text-ink-500">Read-only role — goals cannot be changed.</p>
      )}

      <section className="space-y-4">
        <h3 className="font-semibold">Active goals</h3>
        {!data ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : data.goals.length === 0 ? (
          <div className="bg-white shadow-card rounded-2xl p-8 text-center space-y-2">
            <p className="font-medium">No goals yet</p>
            <p className="text-sm text-ink-500">
              {data.expiredCount > 0 && !includeExpired
                ? `${data.expiredCount} expired goal${data.expiredCount === 1 ? "" : "s"} hidden. Turn on “Show expired” or add a new target.`
                : "Add a revenue or visits target to track pace against the daily log."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.goals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                canWrite={canWrite}
                canDelete={canDelete}
                onEdit={() => fillForm(goal)}
                onDelete={() => onDelete(goal.id, goal.name)}
              />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function GoalCard({
  goal,
  canWrite,
  canDelete,
  onEdit,
  onDelete,
}: {
  goal: PublicGoal;
  canWrite: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const width = Math.max(0, Math.min(100, goal.progressPercent));
  return (
    <article className="bg-white shadow-card rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">{goal.name}</h4>
          <p className="text-xs text-ink-500">
            {metricLabel(goal.metricType)} · {goal.startDate} – {goal.endDate}
          </p>
        </div>
        <span className={`text-xs rounded-full px-2 py-1 font-medium ${statusChipClass(goal.status)}`}>
          {goal.statusLabel}
        </span>
      </div>
      <div>
        <div className="flex justify-between text-xs text-ink-500 mb-1">
          <span>
            {goal.currentDisplay} of {goal.targetDisplay}
          </span>
          <span>{Math.min(goal.progressPercent, 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-2 rounded-full ${barClass(goal.status)}`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-500">
        <div>
          Expected by now: <span className="text-ink-900">{goal.expectedDisplay}</span>
        </div>
        <div>
          Days left: <span className="text-ink-900">{goal.daysRemaining}</span>
        </div>
        <div className="col-span-2">
          Source: {goal.currentSource === "daily_stats" ? "Daily log" : "Manual"}
        </div>
      </dl>
      {canWrite || canDelete ? (
        <div className="flex gap-3 text-sm pt-1">
          {canWrite ? (
            <button type="button" className="text-accent-600 font-medium" onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="text-red-700 font-medium" onClick={onDelete}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
