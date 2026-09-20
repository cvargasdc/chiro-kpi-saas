import type { Config } from "tailwindcss";

export default {
  content: ["./client/index.html", "./client/src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "var(--color-canvas)",
        surface: "var(--color-surface)",
        sidebar: {
          DEFAULT: "var(--color-sidebar)",
          hover: "var(--color-sidebar-hover)",
        },
        border: "var(--color-border)",
        ink: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-muted)",
          // legacy aliases used across pages
          950: "var(--color-text)",
          900: "var(--color-text)",
          700: "var(--color-text)",
          500: "var(--color-muted)",
        },
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          soft: "var(--color-primary-soft)",
          fg: "var(--color-primary-fg)",
        },
        hero: {
          DEFAULT: "var(--color-hero)",
          border: "var(--color-hero-border)",
        },
        // Back-compat for existing class names during Path B restyle
        clinical: {
          50: "var(--color-canvas)",
          100: "var(--color-primary-soft)",
          600: "var(--color-primary)",
          700: "var(--color-primary-hover)",
        },
        accent: {
          500: "var(--color-primary)",
          600: "var(--color-primary-hover)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
    },
  },
  plugins: [],
} satisfies Config;
