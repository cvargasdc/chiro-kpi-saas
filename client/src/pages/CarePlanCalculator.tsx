import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import AppShell from "../components/AppShell";
import {
  api,
  ApiError,
  type CarePlan,
  type CarePlanComplianceResponse,
  type CarePlanPaymentSettings,
  type CarePlanTemplate,
  type CarePlansListResponse,
  type CarePlanTemplatesListResponse,
  type MeResponse,
  type Treatment,
  type TreatmentsListResponse,
} from "../lib/api";
import {
  DEFAULT_PAYMENT_SETTINGS,
  buildLineItems,
  computePaymentQuotes,
} from "@shared/care-plans";
import { formatPriceCents as money } from "@shared/treatments";

type Props = { me: MeResponse; onLogout: () => void };

type SelectionMap = Record<string, number>;

function settingsFromPlan(settings?: CarePlanPaymentSettings | null): CarePlanPaymentSettings {
  return {
    payInFull: {
      enabled: settings?.payInFull.enabled ?? DEFAULT_PAYMENT_SETTINGS.payInFull.enabled,
      discountPercent:
        settings?.payInFull.discountPercent ??
        DEFAULT_PAYMENT_SETTINGS.payInFull.discountPercent,
    },
    monthlyPlan: {
      enabled: settings?.monthlyPlan.enabled ?? DEFAULT_PAYMENT_SETTINGS.monthlyPlan.enabled,
      discountPercent:
        settings?.monthlyPlan.discountPercent ??
        DEFAULT_PAYMENT_SETTINGS.monthlyPlan.discountPercent,
      months: settings?.monthlyPlan.months ?? DEFAULT_PAYMENT_SETTINGS.monthlyPlan.months,
    },
    downPaymentPlan: {
      enabled:
        settings?.downPaymentPlan.enabled ??
        DEFAULT_PAYMENT_SETTINGS.downPaymentPlan.enabled,
      discountPercent:
        settings?.downPaymentPlan.discountPercent ??
        DEFAULT_PAYMENT_SETTINGS.downPaymentPlan.discountPercent,
      months:
        settings?.downPaymentPlan.months ?? DEFAULT_PAYMENT_SETTINGS.downPaymentPlan.months,
      downPaymentPercent:
        settings?.downPaymentPlan.downPaymentPercent ??
        DEFAULT_PAYMENT_SETTINGS.downPaymentPlan.downPaymentPercent,
    },
    planStartDate: settings?.planStartDate ?? null,
  };
}

export default function CarePlanCalculatorPage({ me, onLogout }: Props) {
  const [, setLocation] = useLocation();
  const canWrite = Boolean(me.active?.role && me.active.role !== "readonly");
  const canDelete = me.active?.role === "owner" || me.active?.role === "admin";

  const [compliance, setCompliance] = useState<CarePlanComplianceResponse | null>(
    null,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [templates, setTemplates] = useState<CarePlanTemplate[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [acking, setAcking] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"draft" | "final">("draft");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [selections, setSelections] = useState<SelectionMap>({});
  const [payment, setPayment] = useState<CarePlanPaymentSettings>(
    settingsFromPlan(),
  );
  const [templateName, setTemplateName] = useState("");
  const [showSaved, setShowSaved] = useState(true);

  async function loadCatalog() {
    const body = await api<TreatmentsListResponse>("/api/treatments?active=true");
    setTreatments(body.treatments);
  }

  async function loadPlans() {
    const body = await api<CarePlansListResponse>("/api/care-plans");
    setPlans(body.carePlans);
  }

  async function loadTemplates() {
    const body = await api<CarePlanTemplatesListResponse>(
      "/api/care-plan-templates?active=true",
    );
    setTemplates(body.templates);
  }

  useEffect(() => {
    api<CarePlanComplianceResponse>("/api/care-plans/compliance")
      .then((body) => {
        setCompliance(body);
        setAcknowledged(body.acknowledged);
        if (body.acknowledged) {
          Promise.all([loadCatalog(), loadPlans(), loadTemplates()]).catch((err) =>
            setError(err instanceof Error ? err.message : "Could not load care plans"),
          );
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load compliance notice"),
      );
  }, []);

  const catalog = useMemo(
    () =>
      treatments.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        priceCents: row.priceCents,
        active: row.active,
      })),
    [treatments],
  );

  const selectionList = useMemo(
    () =>
      Object.entries(selections)
        .filter(([, qty]) => qty > 0)
        .map(([treatmentId, quantity]) => ({ treatmentId, quantity })),
    [selections],
  );

  const live = useMemo(() => {
    const { items, subtotalCents } = buildLineItems(selectionList, catalog);
    return {
      items,
      subtotalCents,
      quotes: computePaymentQuotes(subtotalCents, payment),
    };
  }, [selectionList, catalog, payment]);

  function resetForm() {
    setFirstName("");
    setLastName("");
    setNotes("");
    setStatus("draft");
    setCurrentId(null);
    setSelections({});
    setPayment(settingsFromPlan());
    setTemplateName("");
    setError("");
  }

  function setQty(id: string, quantity: number) {
    setSelections((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[id];
      else next[id] = quantity;
      return next;
    });
  }

  async function acknowledge() {
    setError("");
    setAcking(true);
    try {
      await api("/api/care-plans/compliance/acknowledge", { method: "POST" });
      setAcknowledged(true);
      await Promise.all([loadCatalog(), loadPlans(), loadTemplates()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not acknowledge");
    } finally {
      setAcking(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("Enter the patient’s first and last name");
      return;
    }
    if (selectionList.length === 0) {
      setError("Select at least one service");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        notes: notes.trim() || null,
        treatmentSelections: selectionList,
        paymentSettings: payment,
        status,
        ...(templateName.trim()
          ? { saveAsTemplate: true, templateName: templateName.trim() }
          : {}),
      };
      if (currentId) {
        const body = await api<{ carePlan: CarePlan }>(`/api/care-plans/${currentId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setCurrentId(body.carePlan.id);
      } else {
        const body = await api<{ carePlan: CarePlan }>(`/api/care-plans`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setCurrentId(body.carePlan.id);
      }
      setTemplateName("");
      await Promise.all([loadPlans(), loadTemplates()]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setAcknowledged(false);
        setError("compliance_required");
      } else {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf(id: string) {
    setError("");
    setDownloading(true);
    try {
      const res = await fetch(`/api/care-plans/${id}/export.pdf`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setAcknowledged(false);
        throw new Error("compliance_required");
      }
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `care-plan-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setDownloading(false);
    }
  }

  async function onSaveThenPdf() {
    if (!currentId) {
      setError("Save the plan before downloading a PDF");
      return;
    }
    await downloadPdf(currentId);
  }

  function loadPlan(plan: CarePlan) {
    setCurrentId(plan.id);
    setFirstName(plan.firstName);
    setLastName(plan.lastName);
    setNotes(plan.notes ?? "");
    setStatus(plan.status);
    const next: SelectionMap = {};
    for (const row of plan.treatmentSelections) {
      next[row.treatmentId] = row.quantity;
    }
    setSelections(next);
    setPayment(settingsFromPlan(plan.paymentSettings));
    setError("");
  }

  function loadTemplate(template: CarePlanTemplate) {
    const next: SelectionMap = {};
    for (const row of template.defaultSelections.treatmentSelections) {
      next[row.treatmentId] = row.quantity;
    }
    setSelections(next);
    setPayment(settingsFromPlan(template.defaultSelections.paymentSettings));
    setError("");
  }

  async function onDeletePlan(id: string) {
    if (!canDelete) return;
    if (!confirm("Delete this care plan?")) return;
    setError("");
    try {
      await api(`/api/care-plans/${id}`, { method: "DELETE" });
      if (currentId === id) resetForm();
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Treatment[]>();
    for (const row of treatments) {
      const list = map.get(row.category);
      if (list) list.push(row);
      else map.set(row.category, [row]);
    }
    return [...map.entries()];
  }, [treatments]);

  return (
    <AppShell me={me} onLogout={onLogout}>
      {!acknowledged ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 grid place-items-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="care-plan-compliance-title"
            className="bg-white rounded-2xl shadow-card max-w-lg w-full p-6 space-y-4"
          >
            <h2 id="care-plan-compliance-title" className="text-xl font-semibold">
              Care Plan Compliance Notice
            </h2>
            <div className="text-sm text-ink-700 space-y-3 whitespace-pre-line">
              {compliance?.notice ?? "Loading notice…"}
            </div>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setLocation("/")}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Close — return to dashboard
              </button>
              <button
                type="button"
                onClick={acknowledge}
                disabled={acking || !compliance}
                className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
              >
                {acking ? "Saving…" : "I Acknowledge"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Care Plans</h2>
          <p className="text-sm text-ink-500">
            Build a financial care plan from the services catalog. Acknowledge the
            compliance notice before generating.
          </p>
        </div>
        {acknowledged && canWrite ? (
          <button
            type="button"
            onClick={resetForm}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            New plan
          </button>
        ) : null}
      </div>

      {error && acknowledged ? <p className="text-sm text-red-700">{error}</p> : null}

      {!acknowledged ? (
        <p className="text-sm text-ink-500">
          The generator stays locked until you acknowledge the compliance notice.
        </p>
      ) : treatments.length === 0 ? (
        <div className="bg-white shadow-card rounded-2xl p-8 text-center space-y-2">
          <p className="font-medium">No services in the catalog</p>
          <p className="text-sm text-ink-500">
            Add adjustments, therapy, and exams on Services before building a care
            plan.
          </p>
          <Link
            href="/treatments"
            className="inline-block text-sm text-accent-600 font-medium"
          >
            Go to Services
          </Link>
        </div>
      ) : (
        <form onSubmit={onSave} className="space-y-6">
          <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Patient</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">First name</span>
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">Last name</span>
                <input
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="block text-ink-500 mb-1">Notes</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "draft" | "final")}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="draft">Draft</option>
                  <option value="final">Final</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">Plan start date</span>
                <input
                  type="date"
                  value={payment.planStartDate ?? ""}
                  onChange={(e) =>
                    setPayment((prev) => ({
                      ...prev,
                      planStartDate: e.target.value || null,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
            </div>
          </section>

          <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Services</h3>
            <div className="space-y-4">
              {grouped.map(([category, items]) => (
                <div key={category}>
                  <h4 className="text-sm font-medium text-clinical-700 mb-2">
                    {category}
                  </h4>
                  <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {items.map((row) => {
                      const qty = selections[row.id] ?? 0;
                      return (
                        <li
                          key={row.id}
                          className="px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="font-medium">{row.name}</p>
                            <p className="text-xs text-ink-500">{row.priceDisplay}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setQty(row.id, Math.max(0, qty - 1))}
                              className="rounded-lg border border-slate-200 w-8 h-8"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={qty}
                              onChange={(e) =>
                                setQty(row.id, Math.max(0, Number(e.target.value) || 0))
                              }
                              className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-center"
                            />
                            <button
                              type="button"
                              onClick={() => setQty(row.id, qty + 1)}
                              className="rounded-lg border border-slate-200 w-8 h-8"
                            >
                              +
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold">Payment options</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <fieldset className="border border-slate-100 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={payment.payInFull.enabled}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        payInFull: { ...prev.payInFull, enabled: e.target.checked },
                      }))
                    }
                  />
                  Pay in full
                </label>
                <label className="text-sm block">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={payment.payInFull.discountPercent}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        payInFull: {
                          ...prev.payInFull,
                          discountPercent: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  />
                </label>
              </fieldset>
              <fieldset className="border border-slate-100 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={payment.monthlyPlan.enabled}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        monthlyPlan: { ...prev.monthlyPlan, enabled: e.target.checked },
                      }))
                    }
                  />
                  Monthly
                </label>
                <label className="text-sm block">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={payment.monthlyPlan.discountPercent}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        monthlyPlan: {
                          ...prev.monthlyPlan,
                          discountPercent: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  />
                </label>
                <label className="text-sm block">
                  Months
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={payment.monthlyPlan.months}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        monthlyPlan: {
                          ...prev.monthlyPlan,
                          months: Math.max(1, Number(e.target.value) || 1),
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  />
                </label>
              </fieldset>
              <fieldset className="border border-slate-100 rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={payment.downPaymentPlan.enabled}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        downPaymentPlan: {
                          ...prev.downPaymentPlan,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                  />
                  Down payment
                </label>
                <label className="text-sm block">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={payment.downPaymentPlan.discountPercent}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        downPaymentPlan: {
                          ...prev.downPaymentPlan,
                          discountPercent: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  />
                </label>
                <label className="text-sm block">
                  Down payment %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={payment.downPaymentPlan.downPaymentPercent}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        downPaymentPlan: {
                          ...prev.downPaymentPlan,
                          downPaymentPercent: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  />
                </label>
                <label className="text-sm block">
                  Months
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={payment.downPaymentPlan.months}
                    onChange={(e) =>
                      setPayment((prev) => ({
                        ...prev,
                        downPaymentPlan: {
                          ...prev.downPaymentPlan,
                          months: Math.max(1, Number(e.target.value) || 1),
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  />
                </label>
              </fieldset>
            </div>
          </section>

          <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
            <h3 className="font-semibold">Totals</h3>
            <p className="text-lg font-semibold">
              Subtotal {money(live.subtotalCents)}
            </p>
            {live.items.length === 0 ? (
              <p className="text-sm text-ink-500">No services selected.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {live.items.map((item) => (
                  <li key={item.treatmentId}>
                    {item.name} × {item.quantity} = {item.lineTotalDisplay}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 text-sm md:grid-cols-3">
              {live.quotes.payInFull ? (
                <p>
                  Pay in full: {live.quotes.payInFull.totalDisplay} after{" "}
                  {live.quotes.payInFull.discountPercent}% off
                </p>
              ) : null}
              {live.quotes.monthlyPlan ? (
                <p>
                  Monthly: {live.quotes.monthlyPlan.monthlyPaymentDisplay} ×{" "}
                  {live.quotes.monthlyPlan.months}
                </p>
              ) : null}
              {live.quotes.downPaymentPlan ? (
                <p>
                  Down {live.quotes.downPaymentPlan.downPaymentDisplay}, then{" "}
                  {live.quotes.downPaymentPlan.monthlyPaymentDisplay} ×{" "}
                  {live.quotes.downPaymentPlan.months}
                </p>
              ) : null}
            </div>
          </section>

          {canWrite ? (
            <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
              <label className="text-sm block">
                Optional: also save as template
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? "Saving…" : currentId ? "Update plan" : "Save plan"}
                </button>
                <button
                  type="button"
                  onClick={onSaveThenPdf}
                  disabled={downloading || !currentId}
                  className="rounded-lg border border-slate-200 px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
                >
                  {downloading ? "Generating…" : "Download PDF"}
                </button>
              </div>
              {!canWrite ? null : (
                <p className="text-xs text-ink-500">
                  PDF is generated on the server and includes the compliance footer.
                </p>
              )}
            </section>
          ) : (
            <p className="text-sm text-ink-500">
              Read-only role — care plans cannot be changed.
            </p>
          )}
        </form>
      )}

      {acknowledged && templates.length > 0 ? (
        <section className="space-y-2">
          <h3 className="font-semibold">Templates</h3>
          <ul className="bg-white shadow-card rounded-2xl divide-y divide-slate-100">
            {templates.map((row) => (
              <li key={row.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <span>{row.name}</span>
                <button
                  type="button"
                  onClick={() => loadTemplate(row)}
                  className="text-sm text-accent-600 font-medium"
                >
                  Load
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {acknowledged ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Saved plans</h3>
            <button
              type="button"
              onClick={() => setShowSaved((v) => !v)}
              className="text-sm text-ink-500"
            >
              {showSaved ? "Hide" : "Show"}
            </button>
          </div>
          {showSaved ? (
            plans.length === 0 ? (
              <p className="text-sm text-ink-500">No saved care plans yet.</p>
            ) : (
              <ul className="bg-white shadow-card rounded-2xl divide-y divide-slate-100">
                {plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">
                        {plan.firstName} {plan.lastName}
                      </p>
                      <p className="text-xs text-ink-500">
                        {plan.subtotalDisplay} · {plan.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => loadPlan(plan)}
                        className="text-sm text-accent-600 font-medium"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPdf(plan.id)}
                        className="text-sm text-accent-600 font-medium"
                      >
                        PDF
                      </button>
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => onDeletePlan(plan.id)}
                          className="text-sm text-red-700"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
