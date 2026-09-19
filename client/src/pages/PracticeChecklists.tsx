import { FormEvent, useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type PracticeChecklist,
  type PracticeChecklistHistoryResponse,
  type PracticeChecklistManageResponse,
  type PracticeChecklistTodayResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };
type Tab = "today" | "history" | "manage";

const CATEGORIES = [
  "Opening",
  "Closing",
  "Front desk",
  "Clinical",
  "Admin",
  "Other",
] as const;

export default function PracticeChecklistsPage({ me, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [tab, setTab] = useState<Tab>("today");
  const [today, setToday] = useState<PracticeChecklistTodayResponse | null>(null);
  const [history, setHistory] = useState<PracticeChecklistHistoryResponse | null>(
    null,
  );
  const [manage, setManage] = useState<PracticeChecklistManageResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [itemTitle, setItemTitle] = useState("");
  const [itemCategory, setItemCategory] = useState<string>("Opening");
  const [itemChecklistId, setItemChecklistId] = useState("");

  async function loadToday() {
    const body = await api<PracticeChecklistTodayResponse>(
      "/api/practice-checklists/today",
    );
    setToday(body);
  }

  async function loadHistory() {
    const body = await api<PracticeChecklistHistoryResponse>(
      "/api/practice-checklists/history",
    );
    setHistory(body);
  }

  async function loadManage() {
    const body = await api<PracticeChecklistManageResponse>(
      "/api/practice-checklists",
    );
    setManage(body);
    if (!itemChecklistId && body.checklists[0]) {
      setItemChecklistId(body.checklists[0].id);
    }
  }

  useEffect(() => {
    loadToday().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load today"),
    );
  }, []);

  function switchTab(next: Tab) {
    setTab(next);
    setError("");
    if (next === "today") {
      loadToday().catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load today"),
      );
    } else if (next === "history") {
      loadHistory().catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load history"),
      );
    } else {
      loadManage().catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load manage"),
      );
    }
  }

  async function toggleItem(itemId: string) {
    if (!canWrite) return;
    setError("");
    try {
      await api(`/api/practice-checklist-items/${itemId}/toggle`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  async function createChecklist(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api("/api/practice-checklists", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), cadence }),
      });
      setName("");
      await loadManage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function createItem(e: FormEvent) {
    e.preventDefault();
    if (!itemChecklistId) return;
    setError("");
    setSaving(true);
    try {
      await api(`/api/practice-checklists/${itemChecklistId}/items`, {
        method: "POST",
        body: JSON.stringify({
          title: itemTitle.trim(),
          category: itemCategory,
        }),
      });
      setItemTitle("");
      await loadManage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add item failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteChecklist(row: PracticeChecklist) {
    if (!confirm(`Delete checklist “${row.name}”?`)) return;
    setError("");
    try {
      await api(`/api/practice-checklists/${row.id}`, { method: "DELETE" });
      await loadManage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function toggleActive(row: PracticeChecklist) {
    setError("");
    try {
      await api(`/api/practice-checklists/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !row.active }),
      });
      await loadManage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div>
        <h2 className="text-2xl font-semibold">Practice Checklists</h2>
        <p className="text-sm text-ink-500">
          Daily and weekly ops tasks for the clinic. Patient onboarding lives on
          the Onboarding page — do not mix the two.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["today", "history", "manage"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={
              tab === key
                ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 text-sm font-medium"
                : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            }
          >
            {key === "today" ? "Today" : key === "history" ? "History" : "Manage"}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {tab === "today" ? (
        <section className="space-y-4">
          {today ? (
            <p className="text-sm text-ink-500">
              {today.date} · progress {today.progress.done}/{today.progress.total}
            </p>
          ) : null}
          {today?.emptyState === "no_checklists" ? (
            <p className="text-sm text-ink-500">
              No practice checklists yet. Open Manage to create a daily or weekly
              list.
            </p>
          ) : null}
          {today?.emptyState === "no_items" ? (
            <p className="text-sm text-ink-500">
              Checklists exist, but none have active items for today.
            </p>
          ) : null}
          {today?.checklists.map((list) => (
            <div
              key={list.id}
              className="bg-white shadow-card rounded-2xl p-6 space-y-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{list.name}</h3>
                <p className="text-sm text-ink-500">
                  {list.cadence} · {list.progress.done}/{list.progress.total}
                </p>
              </div>
              {list.items.length === 0 ? (
                <p className="text-sm text-ink-500">No active items.</p>
              ) : (
                <ul className="space-y-2">
                  {list.items.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={item.completed}
                        disabled={!canWrite}
                        onChange={() => toggleItem(item.id)}
                      />
                      <span>
                        <span className={item.completed ? "line-through text-ink-500" : ""}>
                          {item.title}
                        </span>
                        <span className="ml-2 text-xs text-ink-500">
                          {item.category}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
          <h3 className="font-semibold">Last 14 days</h3>
          {history?.emptyState === "no_checklists" ? (
            <p className="text-sm text-ink-500">No practice checklists yet.</p>
          ) : null}
          {history?.emptyState === "no_items" ? (
            <p className="text-sm text-ink-500">No items to complete in this range.</p>
          ) : null}
          <ul className="divide-y divide-slate-100">
            {history?.days.map((day) => (
              <li
                key={day.date}
                className="py-2 flex justify-between gap-3 text-sm"
              >
                <span>{day.date}</span>
                <span className="text-ink-500">
                  {day.progress.done}/{day.progress.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "manage" ? (
        <div className="space-y-6">
          {canWrite ? (
            <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
              <h3 className="font-semibold">New checklist</h3>
              <form onSubmit={createChecklist} className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm sm:col-span-2">
                  <span className="block text-ink-500 mb-1">Name</span>
                  <input
                    required
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Opening routine"
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Cadence</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={cadence}
                    onChange={(e) =>
                      setCadence(e.target.value === "weekly" ? "weekly" : "daily")
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </label>
                <div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Create checklist"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {canWrite && manage && manage.checklists.length > 0 ? (
            <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
              <h3 className="font-semibold">Add item</h3>
              <form onSubmit={createItem} className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Checklist</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={itemChecklistId}
                    onChange={(e) => setItemChecklistId(e.target.value)}
                  >
                    {manage.checklists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Title</span>
                  <input
                    required
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={itemTitle}
                    onChange={(e) => setItemTitle(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <label className="text-sm">
                  <span className="block text-ink-500 mb-1">Category</span>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={itemCategory}
                    onChange={(e) => setItemCategory(e.target.value)}
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
                  >
                    Add item
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {manage?.emptyState === "no_checklists" ? (
            <p className="text-sm text-ink-500">
              No practice checklists yet. Create a daily or weekly list above.
            </p>
          ) : null}

          {manage?.checklists.map((list) => (
            <section
              key={list.id}
              className="bg-white shadow-card rounded-2xl p-6 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{list.name}</h3>
                  <p className="text-sm text-ink-500">
                    {list.cadence} · {list.active ? "active" : "inactive"} ·{" "}
                    {list.items?.length ?? 0} items
                  </p>
                </div>
                <div className="flex gap-2">
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => toggleActive(list)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
                    >
                      {list.active ? "Deactivate" : "Activate"}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => deleteChecklist(list)}
                      className="rounded-lg border border-red-200 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              <ul className="text-sm divide-y divide-slate-100">
                {(list.items ?? []).map((item) => (
                  <li key={item.id} className="py-2 flex justify-between gap-3">
                    <span>
                      {item.title}
                      <span className="ml-2 text-xs text-ink-500">
                        {item.category}
                        {item.active ? "" : " · inactive"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
