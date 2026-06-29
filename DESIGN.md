# Design

Visual system for Halevora Tasks. Strategic context lives in [PRODUCT.md](PRODUCT.md). Tokens are
defined in [src/styles/tokens.css](src/styles/tokens.css); this document explains how to use them.

## Theme

Light theme only. A pure-white app surface (`--bg`) with a faintly cool-tinted sunken canvas
(`--bg-sunken`) for the board and its columns. The indigo-violet brand (hue ~286) carries identity
through primary actions, selection, and the focus ring; the surface stays neutral. Color strategy:
**Restrained** (tinted neutrals + one accent). The mood is an early-morning studio: clean light,
everything in its place.

## Color

OKLCH throughout. Roles, not raw values (see `tokens.css`):

- **Surfaces:** `--bg` (app), `--bg-sunken` (board/columns), `--surface` (cards/panels/menus),
  `--surface-2` (hover/raised). Cards are white on the sunken canvas, separated by `--border`.
- **Text:** `--ink` (primary, >=4.5:1 on white), `--ink-muted` (secondary, >=4.5:1), `--ink-subtle`
  (icons and non-text only, never body copy).
- **Brand / interactive:** `--primary`, `--primary-strong` (hover/active), `--primary-weak`
  (selected/hover tint), `--on-primary` (text on primary), `--ring` (focus).
- **Semantic states:** `--success`, `--warning`, `--danger`, `--info`, each with a `-weak` tint.
- **Task status:** `--status-todo`, `--status-progress`, `--status-done`, `--status-reviewed`,
  `--status-overdue`, each with a `-weak` background tint for badges.
- **Priority:** `--prio-urgent`, `--prio-high`, `--prio-normal`, `--prio-low`.

Rule: color never carries meaning alone. Status and priority always pair color with a label or icon.

## Typography

- **One family:** the system sans stack (`--font-sans`). `--font-mono` for IDs/code.
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
