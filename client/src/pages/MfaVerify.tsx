import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { api, type MeResponse } from "../lib/api";

type Props = { onAuthed: (me: MeResponse) => void };

export default function MfaVerifyPage({ onAuthed }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const challengeToken =
    typeof window !== "undefined" ? sessionStorage.getItem("mfaChallenge") : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!challengeToken) {
      setError("No MFA challenge found. Sign in again.");
      return;
    }
    setPending(true);
    try {
      await api("/api/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, code }),
      });
      sessionStorage.removeItem("mfaChallenge");
      const me = await api<MeResponse>("/api/me");
      onAuthed(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-white shadow-card rounded-2xl p-8 space-y-5"
      >
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-ink-500">Chiro-KPI</p>
          <h2 className="text-2xl font-semibold mt-1">Two-factor verification</h2>
          <p className="text-sm text-ink-500 mt-1">
            Enter a 6-digit authenticator code or a one-time recovery code.
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error === "invalid_code" ? "That code was not accepted." : error}
          </p>
        ) : null}
        <label className="block space-y-1">
          <span className="text-sm font-medium">Code</span>
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            required
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? "Verifying…" : "Verify"}
        </button>
        <p className="text-sm text-ink-500">
          <Link href="/login" className="text-accent-600 font-medium">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
