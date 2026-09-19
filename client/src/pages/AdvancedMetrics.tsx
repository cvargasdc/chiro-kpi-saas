import { FormEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type AdvancedMetricsResponse,
  type MeResponse,
  type MetricField,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

function money(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatValue(field: MetricField): string {
  if (!field.available || field.value == null) return "—";
  if (field.unit === "usd") return money(field.value);
  if (field.unit === "percent") return `${field.value.toFixed(1)}%`;
  if (field.unit === "ratio") return `${field.value.toFixed(1)} : 1`;
  if (Number.isInteger(field.value)) return String(field.value);
  return field.value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function sourceLabel(source: string): string {
  return source === "manual" ? "Manual" : "Automatic";
}

export default function AdvancedMetricsPage({ me, onLogout }: Props) {
  const canWrite = me.active?.role && me.active.role !== "readonly";
  const [month, setMonth] = useState(currentMonthUtc);
  const [data, setData] = useState<AdvancedMetricsResponse | null>(null);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [helpOpen, setHelpOpen] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load(nextMonth = month) {
    const body = await api<AdvancedMetricsResponse>(
      `/api/advanced-metrics?month=${encodeURIComponent(nextMonth)}`,
    );
    setData(body);
    const nextDrafts: Record<string, string> = {};
    for (const section of body.sections) {
      for (const field of section.fields) {
        if (field.writable && field.value != null) {
          nextDrafts[field.key] = String(field.value);
        }
      }
    }
    setDrafts(nextDrafts);
  }

  useEffect(() => {
    load(month).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load metrics"),
    );
    setPrompt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function saveField(key: string, raw: string) {
    if (!canWrite) return;
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && !Number.isFinite(value)) {
      setError("Enter a number");
      return;
    }
    setSavingKey(key);
    setError("");
    try {
      const body = await api<AdvancedMetricsResponse>("/api/advanced-metrics", {
        method: "PUT",
        body: JSON.stringify({
          month,
          fields: [{ key, value }],
        }),
      });
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  }

  function onManualBlur(key: string) {
    const raw = drafts[key] ?? "";
    void saveField(key, raw);
  }

  function onManualSubmit(event: FormEvent, key: string) {
    event.preventDefault();
    onManualBlur(key);
  }

  async function loadPrompt() {
    setError("");
    try {
      const body = await api<{ prompt: string }>(
        `/api/advanced-metrics/prompt?month=${encodeURIComponent(month)}`,
      );
      setPrompt(body.prompt);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build prompt");
    }
  }

  async function copyPrompt() {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
  }

  const fieldsByKey = useMemo(() => {
    const map = new Map<string, MetricField>();
    for (const section of data?.sections ?? []) {
      for (const field of section.fields) map.set(field.key, field);
    }
    return map;
  }, [data]);
  void fieldsByKey;

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Advanced Metrics</h2>
          <p className="text-sm text-ink-500">
            GET → SELL → KEEP &amp; Earn. Automatic numbers come from Daily Log and
            Patients. Manual fields save when you leave the input. No patient names
            are stored on this page.
          </p>
        </div>
        <label className="text-sm">
          Month
          <input
            type="month"
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-1.5"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {data?.emptyStateCopy ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {data.emptyStateCopy}
        </div>
      ) : null}

      {!data ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs text-ink-500">
            <span>
              {data.from} – {data.to}
            </span>
            <span>· visits {data.totals.visits}</span>
            <span>· revenue {money(data.totals.revenue)}</span>
            <span>· new patients {data.totals.newPatients}</span>
          </div>

          {data.sections.map((section) => (
            <section key={section.id} className="space-y-3">
              <div>
                <h3 className="text-lg font-semibold">{section.label}</h3>
                <p className="text-sm text-ink-500">{section.blurb}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <article
                    key={field.key}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-card space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium">{field.label}</h4>
                      <span
                        className={
                          field.source === "manual"
                            ? "text-[10px] uppercase tracking-wide rounded-full bg-slate-100 px-2 py-0.5 text-ink-500"
                            : "text-[10px] uppercase tracking-wide rounded-full bg-clinical-100 px-2 py-0.5 text-clinical-700"
                        }
                      >
                        {sourceLabel(field.source)}
                      </span>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums">
                      {formatValue(field)}
                    </p>
                    <p className="text-xs text-ink-500 font-mono">{field.formula}</p>
                    {field.locked && field.lockedMessage ? (
                      <p className="text-xs text-amber-800">{field.lockedMessage}</p>
                    ) : null}
                    {!field.available && field.reason && !field.lockedMessage ? (
                      <p className="text-xs text-ink-500">{field.reason}</p>
                    ) : null}
                    {field.writable && canWrite ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => onManualSubmit(e, field.key)}
                      >
                        <input
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                          inputMode="decimal"
                          value={drafts[field.key] ?? ""}
                          placeholder={field.unit === "usd" ? "0.00" : "0"}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          onBlur={() => onManualBlur(field.key)}
                        />
                        {savingKey === field.key ? (
                          <span className="text-xs text-ink-500">Saving</span>
                        ) : null}
                      </form>
                    ) : null}
                    {field.writable && !canWrite ? (
                      <p className="text-xs text-ink-500">Read-only role cannot edit.</p>
                    ) : null}
                    <button
                      type="button"
                      className="text-xs text-clinical-700 hover:underline"
                      onClick={() =>
                        setHelpOpen((prev) => ({
                          ...prev,
                          [field.key]: !prev[field.key],
                        }))
                      }
                    >
                      {helpOpen[field.key] ? "Hide how to find this number" : "How to find this number"}
                    </button>
                    {helpOpen[field.key] ? (
                      <p className="text-xs text-ink-500 leading-relaxed">
                        {field.helpText}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))}

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card space-y-3">
            <h3 className="text-lg font-semibold">AI analysis prompt</h3>
            <p className="text-sm text-ink-500">
              Builds a paste-ready prompt from practice-level aggregates only (no
              patient names). This app does not call OpenAI.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-clinical-700 text-white px-3 py-1.5 text-sm"
                onClick={() => void loadPrompt()}
              >
                Generate prompt
              </button>
              {prompt ? (
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
                  onClick={() => void copyPrompt()}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              ) : null}
            </div>
            {prompt ? (
              <textarea
                readOnly
                className="w-full min-h-[240px] rounded-lg border border-slate-200 p-3 text-xs font-mono"
                value={prompt}
              />
            ) : null}
          </section>
        </>
      )}
    </AppShell>
  );
}
