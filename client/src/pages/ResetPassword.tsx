import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { api, ApiError } from "../lib/api";

export default function ResetPasswordPage() {
  const [location, setLocation] = useLocation();
  const token = useMemo(() => {
    const query = location.includes("?")
      ? location.slice(location.indexOf("?") + 1)
      : window.location.search.replace(/^\?/, "");
    return new URLSearchParams(query).get("token") ?? "";
  }, [location]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setLocation("/");
      window.location.assign("/");
    } catch (err) {
      if (err instanceof ApiError && err.message === "password_policy") {
        const details =
          err.body && typeof err.body === "object" && "details" in err.body
            ? (err.body as { details?: string[] }).details
            : undefined;
        setError(details?.join(". ") || "Password does not meet policy (12+ characters).");
      } else {
        setError(err instanceof Error ? err.message : "Reset failed");
      }
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
          <h2 className="text-2xl font-semibold mt-1">Choose a new password</h2>
          <p className="text-sm text-ink-500 mt-1">
            At least 12 characters, mixed case, a number, and a special character.
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error === "invalid_or_expired_token"
              ? "This reset link is invalid or has expired."
              : error}
          </p>
        ) : null}
        <label className="block space-y-1">
          <span className="text-sm font-medium">New password</span>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-200 px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <button
          type="submit"
          disabled={pending || !token}
          className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Reset password"}
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
