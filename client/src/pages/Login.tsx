import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { api, type MeResponse } from "../lib/api";

type Props = { onAuthed: (me: MeResponse) => void };

export default function LoginPage({ onAuthed }: Props) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      });
      const me = await api<MeResponse>("/api/me");
      onAuthed(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <aside className="hidden lg:flex flex-col justify-between bg-clinical-700 text-white p-12">
        <div>
          <p className="text-sm tracking-[0.2em] uppercase text-white/70">Chiro-KPI</p>
          <h1 className="mt-6 text-4xl font-semibold leading-tight">
            Practice metrics,
            <br />
            built for ePHI.
          </h1>
          <p className="mt-4 max-w-md text-white/80">
            Path B foundation: multi-tenant isolation, audit logging, and no
            OpenAI subprocessor. Week 2 — auth and tenant shell.
          </p>
        </div>
        <p className="text-sm text-white/60">For Chris Vargas · local rebuild only</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-md bg-white shadow-card rounded-2xl p-8 space-y-5"
        >
          <div>
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="text-sm text-ink-500 mt-1">
              Email or username, plus your password.
            </p>
          </div>
          {error ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error === "invalid_credentials" ? "Invalid credentials." : error}
            </p>
          ) : null}
          <label className="block space-y-1">
            <span className="text-sm font-medium">Email or username</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Password</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-sm text-ink-500">
            New practice?{" "}
            <Link href="/register" className="text-accent-600 font-medium">
              Create an account
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
