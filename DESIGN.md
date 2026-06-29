# Design

Visual system for Halevora Tasks. Strategic context lives in [PRODUCT.md](PRODUCT.md). Tokens are
defined in [src/styles/tokens.css](src/styles/tokens.css); this document explains how to use them.

## Theme

Premium near-black dark theme — ClickUp's density and polish, minus the purple. A near-black app
surface (`--bg`, faint cool tint ~hue 262) over a deeper sunken canvas (`--bg-sunken`) for the
board, with surfaces layered for depth: raised cards/panels (`--surface`), hover/inputs
(`--surface-2`), and a top layer for menus/popovers/toasts (`--surface-3`), separated by subtle
borders and soft layered shadows (`--shadow-card` resting, `--shadow-md` lift, `--shadow-pop`
overlays). A single confident **blue** (`--primary`, hue ~252) carries interactive/active state —
primary actions, selection, focus ring, the active tab; the surface stays neutral and color
otherwise does real semantic work (status, priority, progress, per-board identity). Color
strategy: **Restrained** + intentional semantic color. `color-scheme: dark` renders native
controls/scrollbars dark. The token architecture is variable-based, so a light theme can return
later via an alternate `:root` block.

## Color

OKLCH throughout. Roles, not raw values (see `tokens.css`):

- **Surfaces (layered):** `--bg` (app), `--bg-sunken` (board/columns, recessed), `--surface`
  (cards/panels, raised), `--surface-2` (hover/inputs), `--surface-3` (menus/popovers/toasts, top
  layer). Borders ramp `--border-subtle` < `--border` < `--border-strong`; depth comes from
  `--shadow-card` (resting), `--shadow-md` (hover lift), `--shadow-pop` (overlays), `--shadow-lg`,
  and `--hairline-top`.
- **Text:** `--ink` (primary near-white), `--ink-muted` (secondary, >=4.5:1 on surfaces),
  `--ink-subtle` (icons and non-text only, never body copy).
- **Brand / interactive (blue, hue ~252 — never purple):** `--primary`, `--primary-strong`
  (hover/active), `--primary-weak` (selected/hover tint), `--primary-softer` (faint selected
  fill), `--on-primary` (text on primary), `--ring` (focus).
- **Semantic states:** `--success`, `--warning`, `--danger`, `--info`, each with a `-weak` tint.
- **Task status:** `--status-todo`, `--status-progress`, `--status-done`, `--status-reviewed`,
  `--status-overdue`, each with a `-weak` background tint for badges.
- **Priority:** `--prio-urgent`, `--prio-high`, `--prio-normal`, `--prio-low`.

Rule: color never carries meaning alone. Status and priority always pair color with a label or icon.

## Motion

A small, reusable library lives in `globals.css` (global `@keyframes` + `.hv-*` utilities) and is
token-driven (`--dur-*`, `--ease-out` workhorse, restrained `--ease-spring` for entrance/feedback
only). Surfaces use it consistently: pages fade per navigation, columns/cards/rows reveal in a
gentle `:nth-child` stagger, cards/rows hover-lift, menus/popovers pop, panels drawer-in over a
scrim, completions confirm. Transform/opacity only; every animation runs on mount and ends at the
visible default; `prefers-reduced-motion` collapses durations globally (no animation gates content).

## Typography

- **One family: Inter** (`--font-sans`, via `next/font`), with a system-sans fallback. `--font-mono`
  for IDs/code. Inter font-features + heading tracking tokens (`--tracking-tight/-snug/-wide`).
- **Fixed rem scale** (`--fs-xs` 12 through `--fs-3xl` 36), ~1.2 ratio. No fluid clamp in product UI.
  Default UI size is `--fs-base` (14px); prose uses `--fs-md` (16px).
- Weights: `--fw-regular` 400, `--fw-medium` 500, `--fw-semibold` 600, `--fw-bold` 700. Headings are
  semibold by default.
- Line heights: `--lh-tight` (headings), `--lh-snug`, `--lh-normal` (body). Prose capped at
  `--prose-measure` (70ch); dense tables may run wider.

## Spacing & Layout

- 4px-based spacing scale (`--space-1` .25rem through `--space-8` 4rem). Vary spacing for rhythm.
- Flexbox for 1D, Grid for 2D. Responsive grids: `repeat(auto-fit, minmax(280px, 1fr))`.
- Structural responsiveness (collapse nav, scroll columns), not fluid type.
- Top nav height is `--nav-height` (3.25rem).
- Radii: `--radius-sm` through `--radius-xl`, `--radius-full` for pills/avatars.

## Components

Every interactive component ships all states: default, hover, focus, active, disabled, loading,
error. Conventions:

- Consistent affordances across the app (same button shape, same form-control vocabulary, same icon
  style). Icons are inline SVG.
- Loading uses skeletons, not centered spinners. Empty states teach the interface rather than saying
  "nothing here."
- Modals are a last resort; prefer inline and progressive disclosure. Reuse a single Modal component
  when a modal is genuinely right.
- Shadows are subtle (`--shadow-sm/md/lg`); elevation is meaningful, not decorative.

## Motion

- 120-240ms (`--dur-fast/base/slow`) with `--ease-out` (exponential ease-out, no bounce).
- Motion conveys state (change, feedback, loading, reveal), never decoration. No orchestrated
  page-load sequences.
- Every animation has a `prefers-reduced-motion` fallback; a global reduce rule is in `globals.css`.

## Accessibility

- WCAG 2.2 AA. Contrast verified for body, muted, and placeholder text.
- Visible focus on all interactive elements (`:focus-visible` ring in `globals.css`).
- Full keyboard operability for board actions. Color is never the sole status/priority signal.

## Bans (project-specific, on top of impeccable's absolute bans)

No cream/sand body background, gradient text, glassmorphism-by-default, side-stripe accent borders,
hero-metric template, tracked-uppercase eyebrows, or display fonts in UI labels.
