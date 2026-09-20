import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeClass,
  persistTheme,
  readStoredTheme,
  toggleTheme,
  type Theme,
} from "../lib/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

/** Single shared Context — keep Provider + useTheme in this module only. */
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyThemeClass(theme);
    persistTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => toggleTheme(prev));
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Prefer the provider context. If context is null (duplicate module / Fast
 * Refresh edge case), fall back to lib/theme helpers so the UI never crashes.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;

  const theme = readStoredTheme();
  return {
    theme,
    setTheme: (next: Theme) => {
      applyThemeClass(next);
      persistTheme(next);
    },
    toggle: () => {
      const next = toggleTheme(readStoredTheme());
      applyThemeClass(next);
      persistTheme(next);
    },
  };
}

export type { ThemeContextValue };
