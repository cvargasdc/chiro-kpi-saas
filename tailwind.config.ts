import type { Config } from "tailwindcss";

export default {
  content: ["./client/index.html", "./client/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b1220",
          900: "#111827",
          700: "#334155",
          500: "#64748b",
        },
        clinical: {
          50: "#f4f7fb",
          100: "#e8eef6",
          600: "#1f4e79",
          700: "#163a5c",
        },
        accent: {
          500: "#0f766e",
          600: "#0d5e58",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
} satisfies Config;
