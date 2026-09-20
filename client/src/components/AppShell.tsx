import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { api, type MeResponse } from "../lib/api";
import ThemeToggle from "./ThemeToggle";

type Props = {
  me: MeResponse;
  onLogout: () => void;
  children: ReactNode;
};

type NavItem = { href: string; label: string; match: (loc: string) => boolean };

const PRIMARY_NAV: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    match: (loc) => loc === "/" || loc === "/dashboard",
  },
  {
    href: "/daily-log",
    label: "Daily Log",
    match: (loc) => loc === "/daily-log",
  },
  { href: "/goals", label: "Goals", match: (loc) => loc === "/goals" },
  {
    href: "/patients",
    label: "Patients",
    match: (loc) => loc === "/patients" || loc.startsWith("/patients/"),
  },
  {
    href: "/projects",
    label: "Projects",
    match: (loc) => loc === "/projects" || loc.startsWith("/projects/"),
  },
];

const TOOLS_NAV: NavItem[] = [
  {
    href: "/practice-checklists",
    label: "Checklists",
    match: (loc) => loc === "/practice-checklists",
  },
  {
    href: "/onboarding",
    label: "Onboarding",
    match: (loc) => loc === "/onboarding" || loc.startsWith("/onboarding/"),
  },
  {
    href: "/treatments",
    label: "Services",
    match: (loc) => loc === "/treatments" || loc === "/services",
  },
  {
    href: "/care-plan-calculator",
    label: "Care Plans",
    match: (loc) =>
      loc === "/care-plan-calculator" || loc === "/care-plans",
  },
  {
    href: "/reports",
    label: "Reports",
    match: (loc) => loc === "/reports",
  },
  {
    href: "/advanced-metrics",
    label: "Advanced Metrics",
    match: (loc) => loc === "/advanced-metrics",
  },
];

export default function AppShell({ me, onLogout, children }: Props) {
  const [location] = useLocation();
  const practiceName = me.active?.practiceName ?? "No practice selected";
  const canImport = me.active?.role === "owner" || me.active?.role === "admin";

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <div className="min-h-screen bg-canvas text-ink lg:flex">
      <aside className="lg:w-60 lg:shrink-0 lg:min-h-screen bg-sidebar border-b lg:border-b-0 lg:border-r border-border flex flex-col">
        <div className="px-5 py-5 flex items-center gap-3">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-fg font-bold text-sm"
            aria-hidden="true"
          >
            CK
          </span>
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.22em] uppercase text-ink-muted font-medium">
              Chiro-KPI
            </p>
            <p className="text-sm font-semibold truncate">{practiceName}</p>
          </div>
        </div>

        <nav className="px-3 pb-4 flex-1 space-y-5 overflow-y-auto">
          <NavGroup label="Practice" items={PRIMARY_NAV} location={location} />
          <NavGroup label="Tools" items={TOOLS_NAV} location={location} />
          {canImport ? (
            <NavGroup
              label="Admin"
              items={[
                {
                  href: "/import",
                  label: "Import",
                  match: (loc) => loc === "/import",
                },
              ]}
              location={location}
            />
          ) : null}
        </nav>

        <div className="mt-auto border-t border-border px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{me.user.displayName}</p>
              <p className="text-xs text-ink-muted truncate">
                {me.active?.role ?? "—"}
              </p>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/mfa/enroll"
              className="ck-btn-ghost text-xs px-2.5 py-1"
            >
              {me.user.mfa.enabled ? "MFA on" : "Enable MFA"}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="ck-btn-ghost text-xs px-2.5 py-1"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs tracking-[0.18em] uppercase text-ink-muted">
              Practice workspace
            </p>
            <p className="text-sm font-semibold truncate sm:hidden">
              {practiceName}
            </p>
          </div>
          <div className="flex items-center gap-2 lg:hidden">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 space-y-6 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavGroup({
  label,
  items,
  location,
}: {
  label: string;
  items: NavItem[];
  location: string;
}) {
  return (
    <div>
      <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink href={item.href} current={item.match(location)}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
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
          ? "flex items-center gap-2 rounded-xl bg-primary-soft text-primary border border-primary/30 px-3 py-2 text-sm font-semibold"
          : "flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted hover:bg-sidebar-hover hover:text-ink"
      }
    >
      {current ? (
        <span
          className="h-1.5 w-1.5 rounded-sm rotate-45 bg-primary shrink-0"
          aria-hidden="true"
        />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0" aria-hidden="true" />
      )}
      {children}
    </Link>
  );
}
