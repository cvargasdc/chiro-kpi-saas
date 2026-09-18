import { FormEvent, useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type BillingStatus, type MeResponse, type Patient } from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

type Invite = { id: string; email: string; role: string; expiresAt: string };

export default function DashboardPage({ me, onLogout }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState("");
  const practiceName = me.active?.practiceName ?? "No practice selected";
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

  useEffect(() => {
    loadPatients().catch(() => setPatients([]));
    loadInvites().catch(() => setInvites([]));
    loadBilling().catch(() => setBilling(null));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

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
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-ink-500">Chiro-KPI</p>
            <h1 className="text-xl font-semibold">{practiceName}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-500">
              {me.user.displayName} · {me.active?.role ?? "—"}
            </span>
            <Link href="/mfa/enroll" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
              {me.user.mfa.enabled ? "MFA on" : "Enable MFA"}
            </Link>
            <button
              onClick={logout}
              className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <section className="grid sm:grid-cols-3 gap-4">
          <Stat label="Practice" value={practiceName} />
          <Stat label="Organization" value={me.active?.orgName ?? "—"} />
          <Stat label="Patients" value={String(patients.length)} />
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
      </main>
    </div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white shadow-card rounded-2xl p-5">
      <p className="text-xs uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-lg font-semibold truncate">{value}</p>
    </div>
  );
}
