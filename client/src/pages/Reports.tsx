import { FormEvent, useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type MeResponse,
  type ReportPeriodKey,
  type ReportPreviewResponse,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

const PERIODS: Array<{ key: ReportPeriodKey; label: string }> = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annual", label: "Annual" },
  { key: "custom", label: "Custom" },
];

function money(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatChange(value: number | null): string {
  if (value == null) return "No baseline";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}% vs prior period`;
}

export default function ReportsPage({ me, onLogout }: Props) {
  const [period, setPeriod] = useState<ReportPeriodKey>("weekly");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [preview, setPreview] = useState<ReportPreviewResponse | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  function queryString(nextPeriod = period): string {
    const params = new URLSearchParams({ period: nextPeriod });
    if (nextPeriod === "custom") {
      params.set("from", customFrom);
      params.set("to", customTo);
    }
    return params.toString();
  }

  async function load(nextPeriod = period) {
    if (nextPeriod === "custom" && (!customFrom || !customTo)) return;
    const data = await api<ReportPreviewResponse>(
      `/api/reports/preview?${queryString(nextPeriod)}`,
    );
    setPreview(data);
    if (nextPeriod !== "custom") {
      setCustomFrom(data.period.from);
      setCustomTo(data.period.to);
    }
  }

  useEffect(() => {
    load("weekly").catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load report"),
    );
  }, []);

  async function onCustom(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await load("custom");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load report");
    }
  }

  async function downloadPdf() {
    setError("");
    setDownloading(true);
    try {
      if (period === "custom" && (!customFrom || !customTo)) {
        throw new Error("Choose a from and to date");
      }
      const res = await fetch(`/api/reports/export.pdf?${queryString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = preview
        ? `chiro-kpi-report-${preview.period.from}-to-${preview.period.to}.pdf`
        : "chiro-kpi-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppShell me={me} onLogout={onLogout}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Reports</h2>
          <p className="text-sm text-ink-500">
            {preview
              ? `${preview.period.label} · compared with ${preview.comparisonLabel.toLowerCase()} (${preview.previousFrom}–${preview.previousTo})`
              : "Practice KPIs, goals, referrals, and daily-log trend for a chosen window."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void downloadPdf()}
          disabled={downloading || !preview}
          className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600 disabled:opacity-50"
        >
          {downloading ? "Preparing PDF…" : "Download PDF"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setPeriod(item.key);
              setError("");
              if (item.key !== "custom") {
                load(item.key).catch((err) =>
                  setError(err instanceof Error ? err.message : "Could not load report"),
                );
              }
            }}
            className={
              period === item.key
                ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 text-sm font-medium"
                : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {period === "custom" ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={onCustom}>
          <label className="text-sm">
            <span className="block text-ink-500 mb-1">From</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            <span className="block text-ink-500 mb-1">To</span>
            <input
              type="date"
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-accent-500 text-white px-4 py-2 text-sm font-medium hover:bg-accent-600"
          >
            Apply
          </button>
        </form>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {preview?.comparisonDefinition ? (
        <p className="text-xs text-ink-500">{preview.comparisonDefinition}</p>
      ) : null}

      {preview?.emptyStateCopy ? (
        <p className="text-sm text-ink-500">{preview.emptyStateCopy}</p>
      ) : null}

      {preview && preview.anomalies.revenueWithoutVisits.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {preview.anomalies.revenueWithoutVisits.length} day
          {preview.anomalies.revenueWithoutVisits.length === 1 ? "" : "s"} in this
          period have revenue with zero visits.
        </div>
      ) : null}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Patient visits"
          value={preview ? String(preview.kpis.visits.value) : "—"}
          change={preview ? formatChange(preview.kpis.visits.percentChange) : ""}
        />
        <KpiCard
          label="Revenue"
          value={preview ? money(preview.kpis.revenue.value) : "—"}
          change={preview ? formatChange(preview.kpis.revenue.percentChange) : ""}
        />
        <KpiCard
          label="Office visit average"
          value={preview ? money(preview.kpis.officeVisitAverage.value) : "—"}
          change={
            preview
              ? preview.kpis.officeVisitAverage.value == null
                ? preview.kpis.officeVisitAverage.explanation
                : formatChange(preview.kpis.officeVisitAverage.percentChange)
              : ""
          }
        />
        <KpiCard
          label="New patients"
          value={
            preview
              ? preview.kpis.newPatients.available
                ? String(preview.kpis.newPatients.value)
                : "Not available"
              : "—"
          }
          change={
            preview
              ? preview.kpis.newPatients.available
                ? formatChange(preview.kpis.newPatients.percentChange)
                : preview.kpis.newPatients.reason
              : ""
          }
        />
        <KpiCard
          label="New conversion"
          value={
            preview
              ? preview.kpis.conversion.available
                ? preview.kpis.conversion.value == null
                  ? "—"
                  : `${preview.kpis.conversion.value}%`
                : "Not available"
              : "—"
          }
          change={
            preview
              ? preview.kpis.conversion.available
                ? preview.kpis.conversion.newCount === 0
                  ? "No new patients in this period"
                  : `${preview.kpis.conversion.convertedCount} of ${preview.kpis.conversion.newCount} new · ${formatChange(preview.kpis.conversion.percentChange)}`
                : preview.kpis.conversion.reason
              : ""
          }
        />
      </div>

      <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
        <h3 className="font-semibold">Goals overlapping this period</h3>
        {!preview ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : preview.goals.emptyState === "no_goals" ? (
          <p className="text-sm text-ink-500">No goals overlap this report window.</p>
        ) : (
          <>
            <p className="text-sm text-ink-500">
              {preview.goals.counts.total} goal
              {preview.goals.counts.total === 1 ? "" : "s"} ·{" "}
              {preview.goals.counts.behindPace + preview.goals.counts.belowTarget}{" "}
              behind pace or below target
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-ink-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Goal</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Progress</th>
                    <th className="py-2 font-medium">Window</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.goals.items.map((goal) => (
                    <tr key={goal.id}>
                      <td className="py-2 pr-3 font-medium">{goal.name}</td>
                      <td className="py-2 pr-3">{goal.statusLabel}</td>
                      <td className="py-2 pr-3">
                        {goal.currentDisplay} of {goal.targetDisplay} (
                        {goal.progressPercent}%)
                      </td>
                      <td className="py-2 text-ink-500">
                        {goal.startDate}–{goal.endDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
        <h3 className="font-semibold">Referral sources</h3>
        {!preview ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : preview.referrals.emptyState === "no_entries" ? (
          <p className="text-sm text-ink-500">
            No new or wellness patients in this period.
          </p>
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
                {preview.referrals.rows.map((row) => (
                  <tr key={row.referralSource}>
                    <td className="py-2 pr-3 font-medium">{row.referralSource}</td>
                    <td className="py-2 pr-3">{row.newCount}</td>
                    <td className="py-2 pr-3">{row.convertedCount}</td>
                    <td className="py-2 pr-3">
                      {row.conversionPercent == null ? "—" : `${row.conversionPercent}%`}
                    </td>
                    <td className="py-2">{row.wellnessCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
        <div>
          <h3 className="font-semibold">
            Daily log trend
            {preview ? ` (${preview.trend.grain})` : ""}
          </h3>
          {preview ? (
            <p className="text-xs text-ink-500 mt-1">{preview.trend.grainReason}</p>
          ) : null}
        </div>
        {!preview ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : preview.trend.emptyState === "no_entries" ? (
          <p className="text-sm text-ink-500">No daily-log rows in this period.</p>
        ) : preview.trend.emptyState === "zeros_recorded" ? (
          <p className="text-sm text-ink-500">
            Days were logged, but visits and revenue are all zero.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Period</th>
                  <th className="py-2 pr-3 font-medium">Visits</th>
                  <th className="py-2 font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.trend.points.map((point) => (
                  <tr key={point.key}>
                    <td className="py-2 pr-3">
                      {point.label}
                      {point.partial ? (
                        <span className="ml-2 text-xs text-ink-500">partial</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{point.visits}</td>
                    <td className="py-2">{money(point.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function KpiCard({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string;
}) {
  return (
    <article className="bg-white shadow-card rounded-2xl p-5 space-y-1">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {change ? <p className="text-xs text-ink-500">{change}</p> : null}
    </article>
  );
}
