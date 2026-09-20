# Chiro-KPI Path B — Design System (D light)

Locked light-mode visual for the Path B SaaS rebuild. Dark mode is a refined alternate theme; **default is always bright D-light**.

Reference mockups (spirit, not pixel-perfect):

- [`docs/design/d-light-mockup.png`](./design/d-light-mockup.png)
- [`docs/design/d-dark-mockup.png`](./design/d-dark-mockup.png)

## Principles

- Soft **sage/stone** sidebar in light mode (not charcoal).
- Near-white main canvas (`#F8F7F5`).
- Bright emerald primary (`#10B981`) for active nav and primary buttons.
- Soft **mint** hero/summary band on the Dashboard.
- White surfaces, soft shadows, strong hierarchy (bold titles, large KPI numbers).
- Dark mode: darker sidebar/canvas; emerald remains readable (`#34D399`).

## Tokens (CSS variables)

Defined in `client/src/index.css` on `:root` / `html[data-theme="light"]` and `html.dark`.

| Token | Light (D-light) | Dark |
|-------|-----------------|------|
| `--color-canvas` | `#F8F7F5` | `#0F1210` |
| `--color-surface` | `#FFFFFF` | `#1A1F1C` |
| `--color-sidebar` | `#E8ECE6` | `#141816` |
| `--color-border` | `#E2E5DF` | `#2A312C` |
| `--color-text` | `#111827` | `#F3F4F6` |
| `--color-muted` | `#6B7280` | `#9CA3AF` |
| `--color-primary` | `#10B981` | `#34D399` |
| `--color-primary-soft` | `#D1FAE5` | `#064E3B` |
| `--color-hero` | `#ECFDF5` | `#0D2818` |
| `--shadow-card` | soft slate | soft black |

Tailwind aliases (`canvas`, `surface`, `sidebar`, `border`, `ink`, `primary`, `hero`, plus legacy `clinical` / `accent`) map to these variables in `tailwind.config.ts`. Component helpers: `.ck-card`, `.ck-btn-primary`, `.ck-btn-ghost`, `.ck-input`.

## Theme toggle

- **Provider:** `ThemeProvider` / `useTheme` live in `client/src/components/theme-context.tsx` (single Context module) and wrap the app in `client/src/main.tsx`.
- **Persistence:** `localStorage` key `chiro-kpi-theme` (`light` \| `dark`).
- **Default:** `light` when missing or invalid.
- **Apply:** `dark` class + `data-theme` on `<html>` (Tailwind `darkMode: "class"`).
- **FOUC guard:** inline script in `client/index.html` applies stored dark theme before paint.
- **UI:** accessible `ThemeToggle` in the app shell sidebar footer (and compact header on small screens) with `aria-label` sun/moon control.
- **Helpers:** `client/src/lib/theme.ts` (unit-tested in `tests/theme.test.ts`).

## Shell & Dashboard

- `AppShell` uses a left sidebar (sage in light / charcoal-green in dark), emerald active nav pill, and tokenized surfaces.
- Dashboard opens with a mint **hero band**, large KPI cards, then a **period comparison** bar chart and **insights** list built only from existing `/api/dashboard` fields (no fake API data).

## Verify locally

```bash
npm run dev   # http://localhost:5000
```

1. Sign in → Dashboard should show soft sage sidebar + mint hero + white KPI cards.
2. Use the sun/moon control in the sidebar footer → canvas/sidebar darken; emerald stays readable.
3. Reload → theme persists via `localStorage`.
4. Clear `chiro-kpi-theme` → app returns to D-light.

## Out of scope / safety

Do not break auth, tenancy, or PHI encryption. No OpenAI. No ChiroTouch. Do not deploy this visual work to Replit / chiro-kpi.com from this checklist alone.
