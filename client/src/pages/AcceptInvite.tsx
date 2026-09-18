import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { api, ApiError, type MeResponse } from "../lib/api";

type Preview = {
  email: string;
  role: string;
  practiceName: string;
  orgName: string;
  existingUser: boolean;
};

type Props = { onAuthed: (me: MeResponse) => void };

export default function AcceptInvitePage({ onAuthed }: Props) {
  const [location] = useLocation();
  const token = useMemo(() => {
    const query = location.includes("?")
      ? location.slice(location.indexOf("?") + 1)
      : window.location.search.replace(/^\?/, "");
    return new URLSearchParams(query).get("token") ?? "";
  }, [location]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Missing invite token.");
      return;
    }
    api<Preview>(`/api/invites/preview?token=${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch(() => setLoadError("This invite is invalid or has expired."));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/api/invites/accept", {
        method: "POST",
        body: JSON.stringify({
          token,
          password,
          username: preview?.existingUser ? undefined : username,
          displayName: preview?.existingUser ? undefined : displayName,
        }),
      });
      const me = await api<MeResponse>("/api/me");
      onAuthed(me);
    } catch (err) {
      if (err instanceof ApiError && err.message === "password_policy") {
        setError("Password must be 12+ characters with mixed case, a number, and a symbol.");
      } else {
        setError(err instanceof Error ? err.message : "Could not accept invite");
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
          <h2 className="text-2xl font-semibold mt-1">Join a practice</h2>
          {preview ? (
            <p className="text-sm text-ink-500 mt-1">
              {preview.practiceName} · {preview.role} · {preview.email}
            </p>
          ) : (
            <p className="text-sm text-ink-500 mt-1">Accept a team invitation.</p>
          )}
        </div>
        {loadError ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {loadError}
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : null}
        {preview && !preview.existingUser ? (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Your name</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Username</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
          </>
        ) : null}
        {preview ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {preview.existingUser ? "Password" : "Choose a password"}
            </span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={preview.existingUser ? "current-password" : "new-password"}
              required
            />
          </label>
        ) : null}
        <button
          type="submit"
          disabled={pending || !preview}
          className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? "Joining…" : "Accept invite"}
        </button>
        <p className="text-sm text-ink-500">
          <Link href="/login" className="text-accent-600 font-medium">
            Sign in instead
          </Link>
        </p>
      </form>
    </div>
  );
}
