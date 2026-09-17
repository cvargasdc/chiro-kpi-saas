import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { api, type MeResponse } from "../lib/api";

type Props = { onAuthed: (me: MeResponse) => void };

export default function RegisterPage({ onAuthed }: Props) {
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    username: "",
    password: "",
    organizationName: "",
    practiceName: "",
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const me = await api<MeResponse>("/api/me");
      onAuthed(me);
    } catch (err) {
      const body =
        err && typeof err === "object" && "body" in err
          ? (err as { body: { details?: string[] } }).body
          : null;
      if (body?.details?.length) {
        setError(body.details.join(". "));
      } else {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg bg-white shadow-card rounded-2xl p-8 space-y-4"
      >
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-ink-500">Chiro-KPI</p>
          <h2 className="text-2xl font-semibold mt-1">Create your practice</h2>
          <p className="text-sm text-ink-500 mt-1">
            Password must be at least 12 characters with mixed case, a number,
            and a special character.
          </p>
        </div>
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : null}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Your name" value={form.displayName} onChange={(v) => set("displayName", v)} />
          <Field label="Username" value={form.username} onChange={(v) => set("username", v)} autoComplete="username" />
          <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} autoComplete="email" />
          <Field label="Password" type="password" value={form.password} onChange={(v) => set("password", v)} autoComplete="new-password" />
          <Field label="Organization" value={form.organizationName} onChange={(v) => set("organizationName", v)} />
          <Field label="Practice name" value={form.practiceName} onChange={(v) => set("practiceName", v)} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent-500 text-white py-2.5 font-medium hover:bg-accent-600 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create account"}
        </button>
        <p className="text-sm text-ink-500">
          Already registered?{" "}
          <Link href="/login" className="text-accent-600 font-medium">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        className="w-full rounded-lg border border-slate-200 px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
      />
    </label>
  );
}
