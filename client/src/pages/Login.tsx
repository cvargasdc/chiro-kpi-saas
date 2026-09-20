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
      const result = await api<{ mfaRequired?: boolean; challengeToken?: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ login, password }),
        },
      );
      if (result.mfaRequired && result.challengeToken) {
        sessionStorage.setItem("mfaChallenge", result.challengeToken);
        window.location.assign("/mfa/verify");
        return;
      }
      const me = await api<MeResponse>("/api/me");
      onAuthed(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-canvas">
      <aside className="hidden lg:flex flex-col justify-between bg-primary p-12 text-primary-fg">
        <div>
          <p className="text-sm tracking-[0.2em] uppercase opacity-80">Chiro-KPI</p>
          <h1 className="mt-6 text-4xl font-bold leading-tight">
            Practice metrics,
            <br />
            built for ePHI.
          </h1>
          <p className="mt-4 max-w-md opacity-90">
            Path B foundation: multi-tenant isolation, audit logging, TOTP MFA,
            and no OpenAI subprocessor.
          </p>
        </div>
        <p className="text-sm opacity-70">For Chris Vargas · local rebuild only</p>
      </aside>

      <main className="flex items-center justify-center p-6">
        <form
          onSubmit={onSubmit}
          className="ck-card w-full max-w-md p-8 space-y-5"
        >
          <div>
            <h2 className="text-2xl font-bold">Sign in</h2>
            <p className="text-sm text-ink-muted mt-1">
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
              className="ck-input"
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
              className="ck-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="ck-btn-primary w-full py-2.5 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-sm text-ink-muted">
            <Link href="/forgot-password" className="text-primary font-semibold">
              Forgot password
            </Link>
          </p>
          <p className="text-sm text-ink-muted">
            New practice?{" "}
            <Link href="/register" className="text-primary font-semibold">
              Create an account
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
