import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { api, type MeResponse } from "../lib/api";

type Props = {
  me: MeResponse;
  onLogout: () => void;
  children: ReactNode;
};

export default function AppShell({ me, onLogout, children }: Props) {
  const [location] = useLocation();
  const practiceName = me.active?.practiceName ?? "No practice selected";

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-ink-500">Chiro-KPI</p>
            <h1 className="text-xl font-semibold">{practiceName}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-ink-500">
              {me.user.displayName} · {me.active?.role ?? "—"}
            </span>
            <Link href="/mfa/enroll" className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">
              {me.user.mfa.enabled ? "MFA on" : "Enable MFA"}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-6 pb-3 flex flex-wrap gap-2 text-sm">
          <NavLink href="/" current={location === "/" || location === "/dashboard"}>
            Dashboard
          </NavLink>
          <NavLink href="/daily-log" current={location === "/daily-log"}>
            Daily Log
          </NavLink>
          <NavLink href="/goals" current={location === "/goals"}>
            Goals
          </NavLink>
          <NavLink
            href="/patients"
            current={location === "/patients" || location.startsWith("/patients/")}
          >
            Patients
          </NavLink>
          <NavLink
            href="/practice-checklists"
            current={location === "/practice-checklists"}
          >
            Checklists
          </NavLink>
          <NavLink
            href="/onboarding"
            current={location === "/onboarding" || location.startsWith("/onboarding/")}
          >
            Onboarding
          </NavLink>
          <NavLink
            href="/treatments"
            current={location === "/treatments" || location === "/services"}
          >
            Services
          </NavLink>
          <NavLink
            href="/care-plan-calculator"
            current={
              location === "/care-plan-calculator" || location === "/care-plans"
            }
          >
            Care Plans
          </NavLink>
          <NavLink
            href="/projects"
            current={location === "/projects" || location.startsWith("/projects/")}
          >
            Projects
          </NavLink>
          <NavLink href="/reports" current={location === "/reports"}>
            Reports
          </NavLink>
          <NavLink
            href="/advanced-metrics"
            current={location === "/advanced-metrics"}
          >
            Advanced Metrics
          </NavLink>
          {me.active?.role === "owner" || me.active?.role === "admin" ? (
            <NavLink href="/import" current={location === "/import"}>
              Import
            </NavLink>
          ) : null}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        current
          ? "rounded-lg bg-clinical-100 text-clinical-700 px-3 py-1.5 font-medium"
          : "rounded-lg px-3 py-1.5 text-ink-500 hover:bg-slate-50"
      }
    >
      {children}
    </Link>
  );
}
