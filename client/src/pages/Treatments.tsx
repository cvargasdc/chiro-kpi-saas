import { FormEvent, useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type Treatment,
  type TreatmentMutationResponse,
  type TreatmentsListResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

const CATEGORIES = [
  "Adjustment",
  "Therapy",
  "Exam",
  "X-ray",
  "Massage",
  "Other",
] as const;

type FormState = {
  name: string;
  description: string;
  category: string;
  price: string;
  active: boolean;
  sortOrder: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  category: "Adjustment",
  price: "",
  active: true,
  sortOrder: "0",
};

export default function TreatmentsPage({ me, onLogout }: Props) {
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";
  const [data, setData] = useState<TreatmentsListResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  async function load(includeInactive = showInactive) {
    const qs = includeInactive ? "" : "?active=true";
    const body = await api<TreatmentsListResponse>(`/api/treatments${qs}`);
    setData(body);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load services"),
    );
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function fillForm(row: Treatment) {
    setForm({
      name: row.name,
      description: row.description ?? "",
      category: row.category,
      price: String(row.price),
      active: row.active,
      sortOrder: String(row.sortOrder),
    });
    setEditingId(row.id);
    setError("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const price = Number(form.price);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Price must be zero or greater");
      }
      const sortOrder = Number(form.sortOrder);
      if (!Number.isInteger(sortOrder)) {
        throw new Error("Sort order must be a whole number");
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        price,
        active: form.active,
        sortOrder,
      };
      if (editingId) {
        await api<TreatmentMutationResponse>(`/api/treatments/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api<TreatmentMutationResponse>("/api/treatments", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await load();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete service “${name}”?`)) return;
    setError("");
    try {
      await api(`/api/treatments/${id}`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Services</h2>
          <p className="text-sm text-ink-500">
            Practice treatment catalog and price book. Care plans can use these
            later — this page is the list only.
          </p>
        </div>
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              const next = e.target.checked;
              setShowInactive(next);
              load(next).catch((err) =>
                setError(err instanceof Error ? err.message : "Filter failed"),
              );
            }}
          />
          Show inactive
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {canWrite ? (
        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">{editingId ? "Edit service" : "Add service"}</h3>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
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
                placeholder="e.g. Cervical adjustment"
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Category</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.category}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, category: e.target.value }))
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Price (USD)</span>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.price}
                onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="block text-ink-500 mb-1">Sort order</span>
              <input
                type="number"
                step="1"
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, sortOrder: e.target.value }))
                }
              />
            </label>
            <label className="text-sm flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, active: e.target.checked }))
                }
              />
              Active
            </label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">
              <span className="block text-ink-500 mb-1">Description (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                maxLength={2000}
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
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
        <p className="text-sm text-ink-500">Read-only role — services cannot be changed.</p>
      )}

      <section className="space-y-4">
        {!data ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : data.emptyState === "no_treatments" || data.emptyState === "no_matches" ? (
          <div className="bg-white shadow-card rounded-2xl p-8 text-center space-y-2">
            <p className="font-medium">
              {data.emptyState === "no_treatments"
                ? "No services yet"
                : "No matching services"}
            </p>
            <p className="text-sm text-ink-500">
              {data.emptyState === "no_treatments"
                ? "Add adjustments, therapy, and exams so the catalog is ready for later care plans."
                : "Inactive services are hidden. Turn on “Show inactive” to see them."}
            </p>
          </div>
        ) : (
          data.grouped.map((group) => (
            <div key={group.category} className="space-y-2">
              <h3 className="font-semibold text-clinical-700">{group.category}</h3>
              <div className="bg-white shadow-card rounded-2xl overflow-hidden">
                <ul className="divide-y divide-slate-100">
                  {group.items.map((row) => (
                    <li
                      key={row.id}
                      className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium">
                          {row.name}
                          {!row.active ? (
                            <span className="ml-2 text-xs rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
                              Inactive
                            </span>
                          ) : null}
                        </p>
                        {row.description ? (
                          <p className="text-sm text-ink-500">{row.description}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-medium">{row.priceDisplay}</span>
                        {canWrite ? (
                          <button
                            type="button"
                            className="text-accent-600 font-medium"
                            onClick={() => fillForm(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="text-red-700 font-medium"
                            onClick={() => onDelete(row.id, row.name)}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))
        )}
      </section>
    </AppShell>
  );
}
