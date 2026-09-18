import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { api, ApiError } from "../lib/api";

type StartResponse = { secret: string; otpauthUri: string; mfaEnabled: boolean };
type ConfirmResponse = { mfaEnabled: boolean; recoveryCodes: string[] };

export default function MfaEnrollPage() {
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function start() {
    setError("");
    setPending(true);
    try {
      const data = await api<StartResponse>("/api/auth/mfa/enroll/start", {
        method: "POST",
      });
      setSecret(data.secret);
      setOtpauthUri(data.otpauthUri);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start enrollment");
    } finally {
      setPending(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const data = await api<ConfirmResponse>("/api/auth/mfa/enroll/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setRecovery(data.recoveryCodes);
    } catch (err) {
      const message =
        err instanceof ApiError && err.message === "invalid_code"
          ? "That code was not accepted. Try a fresh one from the app."
          : err instanceof Error
            ? err.message
            : "Confirmation failed";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white shadow-card rounded-2xl p-8 space-y-5">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-ink-500">Chiro-KPI</p>
          <h2 className="text-2xl font-semibold mt-1">Enable authenticator MFA</h2>
          <p className="text-sm text-ink-500 mt-1">
            TOTP is not turned on until you confirm a code. Store recovery codes offline.
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : null}

        {recovery ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Recovery codes (shown once)</p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
              {recovery.map((c) => (
                <li key={c} className="rounded-lg bg-clinical-100 px-3 py-2">
                  {c}
                </li>
              ))}
            </ul>
            <Link href="/" className="inline-block text-accent-600 font-medium text-sm">
              Back to dashboard
            </Link>
          </div>
        ) : !secret ? (
          <button
            type="button"
            onClick={start}
            disabled={pending}
            className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? "Starting…" : "Generate secret"}
          </button>
        ) : (
          <form onSubmit={confirm} className="space-y-4">
            <p className="text-sm">
              Add this secret in your authenticator app, or import the otpauth URI.
            </p>
            <p className="font-mono text-sm break-all rounded-lg bg-clinical-100 px-3 py-2">
              {secret}
            </p>
            <p className="font-mono text-xs break-all text-ink-500">{otpauthUri}</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium">6-digit code</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                required
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
            >
              {pending ? "Confirming…" : "Confirm and enable"}
            </button>
          </form>
        )}

        <p className="text-sm text-ink-500">
          <Link href="/" className="text-accent-600 font-medium">
            Cancel
          </Link>
        </p>
      </div>
    </div>
  );
}
