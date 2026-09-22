import { FormEvent, useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import DailyStatsDialog from "../components/DailyStatsDialog";
import { Link } from "wouter";
import {
  api,
  type BillingStatus,
  type DashboardResponse,
  type GoalsListResponse,
  type MeResponse,
  type Patient,
  type PublicGoal,
} from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

type Invite = { id: string; email: string; role: string; expiresAt: string };
type PeriodKey = "this_week" | "this_month" | "custom";

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

export default function DashboardPage({ me, onLogout }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState("");
  const [kpis, setKpis] = useState<DashboardResponse | null>(null);
  const [kpiError, setKpiError] = useState("");
  const [goals, setGoals] = useState<GoalsListResponse | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("this_week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const canInvite = me.active?.role === "owner" || me.active?.role === "admin";
  const canManageBilling = canInvite;

  async function loadPatients() {
    const data = await api<{ patients: Patient[] }>("/api/patients");
    setPatients(data.patients);
  }

  async function loadInvites() {
    if (!canInvite || !me.active?.practiceId) return;
    const data = await api<{ invites: Invite[] }>(
      `/api/practices/${me.active.practiceId}/invites`,
    );
    setInvites(data.invites);
  }

  async function loadBilling() {
    const data = await api<BillingStatus>("/api/billing/status");
    setBilling(data);
  }

  async function loadDashboard(nextPeriod = period) {
    const params = new URLSearchParams({ period: nextPeriod });
    if (nextPeriod === "custom") {
      if (!customFrom || !customTo) return;
      params.set("from", customFrom);
      params.set("to", customTo);
    }
    const data = await api<DashboardResponse>(`/api/dashboard?${params}`);
    setKpis(data);
    if (nextPeriod !== "custom") {
      setCustomFrom(data.period.from);
      setCustomTo(data.period.to);
    }
  }

  useEffect(() => {
    loadPatients().catch(() => setPatients([]));
    loadInvites().catch(() => setInvites([]));
    loadBilling().catch(() => setBilling(null));
    loadDashboard("this_week").catch((err) =>
      setKpiError(err instanceof Error ? err.message : "Could not load KPIs"),
    );
    api<GoalsListResponse>("/api/goals")
      .then(setGoals)
      .catch(() => setGoals(null));
  }, []);

  return (
    <AppShell me={me} onLogout={onLogout}>
        <section className="rounded-2xl border border-hero-border bg-hero px-5 sm:px-6 py-5 sm:py-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Practice dashboard
              </h2>
              <p className="text-sm text-ink-muted mt-1">
                {kpis
                  ? `${kpis.period.label} · compared with ${kpis.comparisonLabel.toLowerCase()} (${kpis.previousFrom}–${kpis.previousTo})`
                  : "Visits, revenue, and office visit average from the daily log."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DailyStatsDialog
                me={me}
                onComplete={() => {
                  setKpiError("");
                  loadDashboard(period).catch((err) =>
                    setKpiError(
                      err instanceof Error ? err.message : "Could not load KPIs",
                    ),
                  );
                  loadPatients().catch(() => setPatients([]));
                }}
              />
              {(["this_week", "this_month", "custom"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setPeriod(key);
                    setKpiError("");
                    if (key !== "custom") {
                      loadDashboard(key).catch((err) =>
                        setKpiError(err instanceof Error ? err.message : "Could not load KPIs"),
                      );
                    }
                  }}
                  className={
                    period === key
                      ? "rounded-lg bg-primary text-primary-fg px-3 py-1.5 text-sm font-semibold shadow-sm"
                      : "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:bg-sidebar-hover"
                  }
                >
                  {key === "this_week" ? "This week" : key === "this_month" ? "This month" : "Custom"}
                </button>
              ))}
            </div>
          </div>
          {period === "custom" ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setKpiError("");
                loadDashboard("custom").catch((err) =>
                  setKpiError(err instanceof Error ? err.message : "Could not load KPIs"),
                );
              }}
            >
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">From</span>
                <input
                  type="date"
                  className="ck-input"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                <span className="block text-ink-500 mb-1">To</span>
                <input
                  type="date"
                  className="ck-input"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="ck-btn-primary">
                Apply
              </button>
            </form>
          ) : null}
          {kpiError ? (
            <p className="text-sm text-[color:var(--color-danger)]">{kpiError}</p>
          ) : null}
          {kpis?.emptyStateCopy ? (
            <p className="text-sm text-ink-muted">{kpis.emptyStateCopy}</p>
          ) : null}
          {kpis && kpis.anomalies.revenueWithoutVisits.length > 0 ? (
            <div
              className="rounded-2xl px-4 py-3 text-sm"
              style={{
                border: "1px solid var(--color-warning-border)",
                background: "var(--color-warning-soft)",
                color: "var(--color-warning)",
              }}
            >
              {kpis.anomalies.revenueWithoutVisits.length} day
              {kpis.anomalies.revenueWithoutVisits.length === 1 ? "" : "s"} in this
              period have revenue with zero visits.
            </div>
          ) : null}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Patient visits"
              value={kpis ? String(kpis.kpis.visits.value) : "—"}
              change={kpis ? formatChange(kpis.kpis.visits.percentChange) : ""}
            />
            <KpiCard
              label="Revenue"
              value={kpis ? money(kpis.kpis.revenue.value) : "—"}
              change={kpis ? formatChange(kpis.kpis.revenue.percentChange) : ""}
            />
            <KpiCard
              label="Office visit average"
              value={kpis ? money(kpis.kpis.officeVisitAverage.value) : "—"}
              change={
                kpis
                  ? kpis.kpis.officeVisitAverage.value == null
                    ? kpis.kpis.officeVisitAverage.explanation
                    : formatChange(kpis.kpis.officeVisitAverage.percentChange)
                  : ""
              }
            />
            <KpiCard
              label="New patients"
              value={
                kpis
                  ? kpis.kpis.newPatients.available
                    ? String(kpis.kpis.newPatients.value)
                    : "Not available"
                  : "—"
              }
              change={
                kpis
                  ? kpis.kpis.newPatients.available
                    ? `${formatChange(kpis.kpis.newPatients.percentChange)}${
                        kpis.kpis.wellnessPatients.available
                          ? ` · ${kpis.kpis.wellnessPatients.value} wellness`
                          : ""
                      }`
                    : kpis.kpis.newPatients.reason
                  : ""
              }
            />
            <KpiCard
              label="New conversion"
              value={
                kpis
                  ? kpis.kpis.conversion.available
                    ? kpis.kpis.conversion.value == null
                      ? "—"
                      : `${kpis.kpis.conversion.value}%`
                    : "Not available"
                  : "—"
              }
              change={
                kpis
                  ? kpis.kpis.conversion.available
                    ? kpis.kpis.conversion.newCount === 0
                      ? "No new patients in this period"
                      : `${kpis.kpis.conversion.convertedCount} of ${kpis.kpis.conversion.newCount} new · ${formatChange(kpis.kpis.conversion.percentChange)}`
                    : kpis.kpis.conversion.reason
                  : ""
              }
            />
          </div>
        </section>

        {kpis ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <ComparisonBars kpis={kpis} />
            <InsightsPanel kpis={kpis} />
          </div>
        ) : null}

        <GoalsSummary goals={goals} />

        {kpis?.onboarding ? (
          <section className="ck-card space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Patient onboarding</h2>
              <Link href="/onboarding" className="text-sm text-primary font-semibold">
                Open onboarding
              </Link>
            </div>
            {kpis.onboarding.emptyState === "no_assignments" ? (
              <p className="text-sm text-ink-muted">
                No onboarding checklists assigned. Incomplete count is 0 — not a
                hidden backlog.
              </p>
            ) : kpis.onboarding.emptyState === "all_complete" ? (
              <p className="text-sm text-ink-muted">
                All {kpis.onboarding.assignedCount} assigned onboarding
                checklists are complete.
              </p>
            ) : (
              <p className="text-sm">
                <span className="font-semibold">
                  {kpis.onboarding.incompleteCount}
                </span>{" "}
                incomplete of {kpis.onboarding.assignedCount} assigned.
              </p>
            )}
          </section>
        ) : null}

        <BillingCard
          billing={billing}
          error={billingError}
          canManage={Boolean(canManageBilling)}
          onError={setBillingError}
        />

        <section className="ck-card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Patients</h2>
            <Link href="/patients" className="text-sm text-primary font-semibold">
              View patients
            </Link>
          </div>
          {error ? (
            <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
          ) : null}
          {patients.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No patients in this practice yet.{" "}
              <Link href="/patients" className="text-primary font-semibold">
                Add a patient
              </Link>{" "}
              to unlock new-patient and conversion KPIs.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)]">
              {patients.slice(0, 8).map((p) => (
                <li key={p.id} className="py-2 flex justify-between gap-3 text-sm">
                  <Link href={`/patients/${p.id}`} className="font-medium text-primary">
                    {p.name}
                  </Link>
                  <span className="text-ink-muted capitalize">
                    {p.patientType}
                    {p.converted ? " · converted" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canInvite ? (
          <TeamInvites
            practiceId={me.active!.practiceId}
            inviteEmail={inviteEmail}
            inviteRole={inviteRole}
            invites={invites}
            onEmail={setInviteEmail}
            onRole={setInviteRole}
            onRefresh={async () => {
              setInviteEmail("");
              await loadInvites();
            }}
          />
        ) : null}
    </AppShell>
  );
}

function TeamInvites({
  practiceId,
  inviteEmail,
  inviteRole,
  invites,
  onEmail,
  onRole,
  onRefresh,
}: {
  practiceId: string;
  inviteEmail: string;
  inviteRole: string;
  invites: Invite[];
  onEmail: (v: string) => void;
  onRole: (v: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");

  async function send(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api(`/api/practices/${practiceId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      await api(`/api/practices/${practiceId}/invites/${id}`, { method: "DELETE" });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  return (
    <section className="ck-card space-y-4">
      <h2 className="text-lg font-bold">Team invites</h2>
      <p className="text-sm text-ink-muted">
        Owner and admin only. Week 3 emails go to the in-memory/log stub, not Resend.
      </p>
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
      <form onSubmit={send} className="flex flex-wrap gap-2">
        <input
          type="email"
          className="ck-input flex-1 min-w-[12rem]"
          placeholder="teammate@clinic.test"
          value={inviteEmail}
          onChange={(e) => onEmail(e.target.value)}
          required
        />
        <select
          className="ck-input w-auto"
          value={inviteRole}
          onChange={(e) => onRole(e.target.value)}
        >
          <option value="admin">admin</option>
          <option value="clinician">clinician</option>
          <option value="staff">staff</option>
          <option value="readonly">readonly</option>
        </select>
        <button type="submit" className="ck-btn-primary">
          Invite
        </button>
      </form>
      {invites.length === 0 ? (
        <p className="text-sm text-ink-muted">No pending invites.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)]">
          {invites.map((row) => (
            <li key={row.id} className="py-2 flex justify-between gap-3 text-sm">
              <span>
                {row.email} · {row.role}
              </span>
              <button
                type="button"
                onClick={() => revoke(row.id)}
                className="text-primary font-semibold"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BillingCard({
  billing,
  error,
  canManage,
  onError,
}: {
  billing: BillingStatus | null;
  error: string;
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const status = billing?.subscriptionStatus ?? "unknown";
  const plan = billing?.plan ?? "—";
  const trial =
    billing?.trialEndsAt && status === "trialing"
      ? new Date(billing.trialEndsAt).toLocaleDateString()
      : null;

  async function openSession(path: "/api/billing/checkout-session" | "/api/billing/portal-session") {
    onError("");
    setBusy(path.includes("checkout") ? "checkout" : "portal");
    try {
      const data = await api<{ url: string }>(path, { method: "POST" });
      if (data.url) {
        window.location.assign(data.url);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Billing request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="ck-card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Billing</h2>
        <span className="text-xs rounded-full bg-primary-soft text-primary px-2 py-1 capitalize font-medium">
          {status}
        </span>
      </div>
      <p className="text-sm text-ink-muted">
        Plan {plan}
        {trial ? ` · trial ends ${trial}` : ""}
        {billing?.enforce ? " · enforcement on" : " · local/dev (not enforced)"}
      </p>
      {error ? (
        <p className="text-sm text-[color:var(--color-danger)]">{error}</p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => openSession("/api/billing/checkout-session")}
            className="ck-btn-primary"
          >
            {busy === "checkout" ? "Opening…" : "Subscribe"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => openSession("/api/billing/portal-session")}
            className="ck-btn-ghost disabled:opacity-50"
          >
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Owner and admin manage billing for this organization.
        </p>
      )}
    </section>
  );
}

function GoalsSummary({ goals }: { goals: GoalsListResponse | null }) {
  const list = goals?.goals ?? [];
  const alerts = list.filter(
    (g) => g.status === "behind_pace" || g.status === "below_target",
  );
  const preview = list.filter((g) => g.status !== "expired").slice(0, 3);

  return (
    <section className="ck-card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Goals</h2>
        <Link href="/goals" className="text-sm text-primary font-semibold">
          View goals
        </Link>
      </div>
      {alerts.length > 0 ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            border: "1px solid var(--color-warning-border)",
            background: "var(--color-warning-soft)",
            color: "var(--color-warning)",
          }}
        >
          {alerts.length} goal{alerts.length === 1 ? "" : "s"} behind pace or below
          target: {alerts.map((g) => g.name).join(", ")}.{" "}
          <Link href="/goals" className="font-medium underline">
            Review on Goals
          </Link>
        </div>
      ) : null}
      {preview.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No active goals yet.{" "}
          <Link href="/goals" className="text-primary font-semibold">
            Set a goal
          </Link>{" "}
          to track revenue or visits against the daily log.
        </p>
      ) : (
        <ul className="space-y-3">
          {preview.map((goal) => (
            <DashboardGoalRow key={goal.id} goal={goal} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DashboardGoalRow({ goal }: { goal: PublicGoal }) {
  const width = Math.max(0, Math.min(100, goal.progressPercent));
  const chip =
    goal.status === "behind_pace" || goal.status === "below_target"
      ? "bg-[color:var(--color-warning-soft)] text-[color:var(--color-warning)]"
      : goal.status === "achieved"
        ? "bg-primary-soft text-primary"
        : "bg-primary-soft text-primary";
  return (
    <li>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium truncate">{goal.name}</span>
        <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${chip}`}>
          {goal.statusLabel}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-sidebar overflow-hidden">
        <div
          className="h-1.5 rounded-full bg-primary"
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {goal.currentDisplay} of {goal.targetDisplay}
      </p>
    </li>
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
    <div className="ck-card p-5">
      <p className="text-xs uppercase tracking-wide text-ink-muted font-medium">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tracking-tight truncate text-ink">
        {value}
      </p>
      {change ? (
        <p className="mt-2 text-xs text-ink-muted leading-snug">{change}</p>
      ) : null}
    </div>
  );
}

function ComparisonBars({ kpis }: { kpis: DashboardResponse }) {
  const rows = [
    {
      label: "Patient visits",
      current: kpis.kpis.visits.value,
      previous: kpis.kpis.visits.previousValue,
      format: (n: number) => String(n),
    },
    {
      label: "Revenue",
      current: kpis.kpis.revenue.value,
      previous: kpis.kpis.revenue.previousValue,
      format: (n: number) => money(n),
    },
  ];

  return (
    <section className="ck-card space-y-5">
      <div>
        <h2 className="text-lg font-bold">Period comparison</h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Current vs {kpis.comparisonLabel.toLowerCase()} — from existing KPI
          totals (no extra API fields).
        </p>
      </div>
      <div className="space-y-5">
        {rows.map((row) => {
          const max = Math.max(row.current, row.previous, 1);
          const curPct = Math.round((row.current / max) * 100);
          const prevPct = Math.round((row.previous / max) * 100);
          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm mb-2">
                <span className="font-semibold">{row.label}</span>
                <span className="text-ink-muted text-xs">
                  {row.format(row.current)} now · {row.format(row.previous)} prior
                </span>
              </div>
              <div className="space-y-1.5">
                <BarRow label="Current" width={curPct} tone="primary" />
                <BarRow label="Prior" width={prevPct} tone="muted" />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BarRow({
  label,
  width,
  tone,
}: {
  label: string;
  width: number;
  tone: "primary" | "muted";
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-[11px] uppercase tracking-wide text-ink-muted shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2.5 rounded-full bg-sidebar overflow-hidden">
        <div
          className={
            tone === "primary"
              ? "h-2.5 rounded-full bg-primary"
              : "h-2.5 rounded-full bg-ink-muted/40"
          }
          style={{ width: `${Math.max(2, Math.min(100, width))}%` }}
        />
      </div>
    </div>
  );
}

function InsightsPanel({ kpis }: { kpis: DashboardResponse }) {
  const items: string[] = [];
  const { visits, revenue, officeVisitAverage, newPatients, conversion } =
    kpis.kpis;

  if (visits.percentChange != null) {
    items.push(
      `Visits ${visits.percentChange >= 0 ? "up" : "down"} ${Math.abs(visits.percentChange)}% vs prior period.`,
    );
  }
  if (revenue.percentChange != null) {
    items.push(
      `Revenue ${revenue.percentChange >= 0 ? "up" : "down"} ${Math.abs(revenue.percentChange)}% vs prior period.`,
    );
  }
  if (officeVisitAverage.value != null) {
    items.push(`Office visit average is ${money(officeVisitAverage.value)}.`);
  } else {
    items.push(officeVisitAverage.explanation);
  }
  if (newPatients.available) {
    items.push(`${newPatients.value} new patients in this window.`);
  } else {
    items.push(newPatients.reason);
  }
  if (conversion.available) {
    if (conversion.value == null) {
      items.push("Conversion rate not yet computable for this period.");
    } else {
      items.push(
        `New-patient conversion ${conversion.value}% (${conversion.convertedCount} of ${conversion.newCount}).`,
      );
    }
  }
  if (kpis.anomalies.revenueWithoutVisits.length > 0) {
    items.push(
      `${kpis.anomalies.revenueWithoutVisits.length} day(s) logged revenue with zero visits.`,
    );
  }
  if (kpis.onboarding) {
    if (kpis.onboarding.emptyState === "has_incomplete") {
      items.push(
        `${kpis.onboarding.incompleteCount} onboarding checklist(s) still incomplete.`,
      );
    } else if (kpis.onboarding.emptyState === "all_complete") {
      items.push("All assigned onboarding checklists are complete.");
    }
  }

  return (
    <section className="ck-card space-y-4">
      <div>
        <h2 className="text-lg font-bold">Insights</h2>
        <p className="text-sm text-ink-muted mt-0.5">
          Derived from the same dashboard payload as the KPI cards.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">No insights yet for this period.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.slice(0, 6).map((line) => (
            <li
              key={line}
              className="flex gap-2.5 text-sm leading-snug text-ink"
            >
              <span
                className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                aria-hidden="true"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
