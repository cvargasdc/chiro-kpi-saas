/** Chiro-KPI Path B theme helpers (D-light default). */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "chiro-kpi-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Resolve persisted theme; missing/invalid → light (D-light default). */
export function resolveTheme(stored: string | null | undefined): Theme {
  if (isTheme(stored)) return stored;
  return "light";
}

export function readStoredTheme(
  storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage,
): Theme {
  try {
    return resolveTheme(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return "light";
  }
}

export function persistTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / denied — ignore */
  }
}

/** Apply theme class on <html> for Tailwind `dark:` and CSS variables. */
export function applyThemeClass(
  theme: Theme,
  root: HTMLElement | null | undefined = typeof document !== "undefined"
    ? document.documentElement
    : null,
): void {
  if (!root) return;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}
