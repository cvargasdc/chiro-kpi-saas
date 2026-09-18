import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { api } from "../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setDone(true);
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
          <h2 className="text-2xl font-semibold mt-1">Forgot password</h2>
          <p className="text-sm text-ink-500 mt-1">
            Enter your email. If an account exists, we will send a reset link.
          </p>
        </div>
        {done ? (
          <p className="text-sm text-clinical-700 bg-clinical-100 rounded-lg px-3 py-2">
            If an account exists for that email, a reset link has been sent.
          </p>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
        )}
        {!done ? (
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send reset link"}
          </button>
        ) : null}
        <p className="text-sm text-ink-500">
          <Link href="/login" className="text-accent-600 font-medium">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
