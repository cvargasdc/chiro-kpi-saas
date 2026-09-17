import { FormEvent, useEffect, useState } from "react";
import { api, type MeResponse, type Patient } from "../lib/api";

type Props = { me: MeResponse; onLogout: () => void };

export default function DashboardPage({ me, onLogout }: Props) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const practiceName = me.active?.practiceName ?? "No practice selected";

  async function loadPatients() {
    const data = await api<{ patients: Patient[] }>("/api/patients");
    setPatients(data.patients);
  }

  useEffect(() => {
    loadPatients().catch(() => setPatients([]));
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

        <section className="bg-white shadow-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Patients (stub)</h2>
            <span className="text-xs rounded-full bg-clinical-100 text-clinical-700 px-2 py-1">
              Path B · ePHI
            </span>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
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
      </main>
    </div>
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
