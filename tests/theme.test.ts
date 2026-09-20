import { describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyThemeClass,
  isTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  toggleTheme,
} from "../client/src/lib/theme";

describe("theme helpers (D-light default)", () => {
  it("defaults invalid or missing storage to light", () => {
    expect(resolveTheme(null)).toBe("light");
    expect(resolveTheme(undefined)).toBe("light");
    expect(resolveTheme("")).toBe("light");
    expect(resolveTheme("purple")).toBe("light");
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("system")).toBe(false);
  });

  it("reads and persists via a Storage-like object", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };

    expect(readStoredTheme(storage)).toBe("light");
    persistTheme("dark", storage);
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredTheme(storage)).toBe("dark");
  });

  it("toggles light ↔ dark and applies html class + data-theme", () => {
    expect(toggleTheme("light")).toBe("dark");
    expect(toggleTheme("dark")).toBe("light");

    const root = {
      classList: {
        dark: false,
        toggle(name: string, force?: boolean) {
          if (name === "dark") this.dark = Boolean(force);
        },
      },
      dataset: {} as Record<string, string>,
    };

    applyThemeClass("dark", root as unknown as HTMLElement);
    expect(root.classList.dark).toBe(true);
    expect(root.dataset.theme).toBe("dark");

    applyThemeClass("light", root as unknown as HTMLElement);
    expect(root.classList.dark).toBe(false);
    expect(root.dataset.theme).toBe("light");
  });
});
