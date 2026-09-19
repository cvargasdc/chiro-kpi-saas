import { FormEvent, useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import {
  api,
  type BillingStatus,
  type DashboardResponse,
  type MeResponse,
  type Patient,
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
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState("");
  const [kpis, setKpis] = useState<DashboardResponse | null>(null);
  const [kpiError, setKpiError] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("this_week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const canWrite = me.active?.role && me.active.role !== "readonly";
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
  }, []);

  async function addPatient(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/patients", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      await loadPatients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create patient");
    }
  }

  return (
    <AppShell me={me} onLogout={onLogout}>
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Practice dashboard</h2>
              <p className="text-sm text-ink-500">
                {kpis
                  ? `${kpis.period.label} · compared with ${kpis.comparisonLabel.toLowerCase()} (${kpis.previousFrom}–${kpis.previousTo})`
                  : "Visits, revenue, and office visit average from the daily log."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
                      ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 text-sm font-medium"
                      : "rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
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
          {kpiError ? <p className="text-sm text-red-700">{kpiError}</p> : null}
          {kpis?.emptyStateCopy ? (
            <p className="text-sm text-ink-500">{kpis.emptyStateCopy}</p>
          ) : null}
          {kpis && kpis.anomalies.revenueWithoutVisits.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {kpis.anomalies.revenueWithoutVisits.length} day
              {kpis.anomalies.revenueWithoutVisits.length === 1 ? "" : "s"} in this
              period have revenue with zero visits.
            </div>
          ) : null}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              label="New patients / conversion"
              value="Not available"
              change={kpis?.kpis.newPatients.reason ?? "Conversion fields are not in this release."}
            />
          </div>
        </section>

        <BillingCard
          billing={billing}
          error={billingError}
          canManage={Boolean(canManageBilling)}
          onError={setBillingError}
        />

        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Patients (stub)</h2>
            <span className="text-xs rounded-full bg-clinical-100 text-clinical-700 px-2 py-1">
              Path B · ePHI
            </span>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {canWrite ? (
            <form onSubmit={addPatient} className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2"
                placeholder="Patient name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button
                type="submit"
                className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600"
              >
                Add
              </button>
            </form>
          ) : (
            <p className="text-sm text-ink-500">Read-only role — patient records cannot be changed.</p>
          )}
          {patients.length === 0 ? (
            <p className="text-sm text-ink-500">No patients in this practice yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {patients.map((p) => (
                <li key={p.id} className="py-2 flex justify-between text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-ink-500">{p.status}</span>
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
    <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
      <h2 className="font-semibold">Team invites</h2>
      <p className="text-sm text-ink-500">
        Owner and admin only. Week 3 emails go to the in-memory/log stub, not Resend.
      </p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <form onSubmit={send} className="flex flex-wrap gap-2">
        <input
          type="email"
          className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2"
          placeholder="teammate@clinic.test"
          value={inviteEmail}
          onChange={(e) => onEmail(e.target.value)}
          required
        />
        <select
          className="rounded-lg border border-slate-200 px-3 py-2"
          value={inviteRole}
          onChange={(e) => onRole(e.target.value)}
        >
          <option value="admin">admin</option>
          <option value="clinician">clinician</option>
          <option value="staff">staff</option>
          <option value="readonly">readonly</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600"
        >
          Invite
        </button>
      </form>
      {invites.length === 0 ? (
        <p className="text-sm text-ink-500">No pending invites.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {invites.map((row) => (
            <li key={row.id} className="py-2 flex justify-between gap-3 text-sm">
              <span>
                {row.email} · {row.role}
              </span>
              <button
                type="button"
                onClick={() => revoke(row.id)}
                className="text-accent-600 font-medium"
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
    <section className="bg-white shadow-card rounded-2xl p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Billing</h2>
        <span className="text-xs rounded-full bg-slate-100 text-slate-700 px-2 py-1 capitalize">
          {status}
        </span>
      </div>
      <p className="text-sm text-ink-500">
        Plan {plan}
        {trial ? ` · trial ends ${trial}` : ""}
        {billing?.enforce ? " · enforcement on" : " · local/dev (not enforced)"}
      </p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => openSession("/api/billing/checkout-session")}
            className="rounded-lg bg-accent-500 text-white px-4 py-2 font-medium hover:bg-accent-600 disabled:opacity-50"
          >
            {busy === "checkout" ? "Opening…" : "Subscribe"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => openSession("/api/billing/portal-session")}
            className="rounded-lg border border-slate-200 px-4 py-2 font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "portal" ? "Opening…" : "Manage billing"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-500">Owner and admin manage billing for this organization.</p>
      )}
    </section>
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
    <div className="bg-white shadow-card rounded-2xl p-5">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold truncate">{value}</p>
      {change ? <p className="mt-1 text-xs text-ink-500 leading-snug">{change}</p> : null}
    </div>
  );
}
