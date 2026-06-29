# Product

## Register

product

## Users

The Halevora team, in two roles.

- **CEO (Noel Pollak).** Oversees all work, sees every task on every board, assigns and reviews,
  needs full cross-team visibility at a glance.
- **Team member (VA / staff).** Works a personal queue. Opens "My Tasks," moves cards through
  statuses, receives work assigned by anyone, coordinates through per-board chat. Distributed
  across time zones; uses desktop and a phone browser; mixed technical literacy.

Both are in a coordination workflow: capture work, see what is mine, move it forward, know what is
late, talk about it in context. The primary task on any screen is finding and advancing tasks.

## Product Purpose

A self-hosted, faithful clone of ClickUp's Board (Kanban) section, tailored to Halevora. It exists
so the team owns its task tool: their data, their rules, no per-seat fees. Success is the team
preferring it to ClickUp because members find and finish their work fast, the CEO has complete
visibility, recurring work runs reliably, and nothing is ever lost.

## Brand Personality

Focused. Dependable. Unfussy. The voice is plain and direct (no jargon, no hype, no em dashes). The
interface should feel like a calm, well-organized desk, not a control room. Familiar enough to use
without a manual; quietly better-made than the tool it replaces.

## Anti-references

- **ClickUp's own visual overload.** Feature-soup density, competing colors, and chrome everywhere
  are exactly what we are escaping. Match its layout and mechanics, not its noise.
- **Jira's heaviness.** Slow, enterprise-gray, configuration-first.
- **Engagement-driven consumer apps.** No streaks, badges, confetti, fake urgency, or gamified
  dashboards. This is a work tool, not an attention trap.
- **AI-slop SaaS.** No cream/sand body background, no gradient text, no glassmorphism, no
  hero-metric template, no tracked-uppercase eyebrows.

## Design Principles

1. **The tool disappears into the task.** Earned familiarity over novelty. Standard affordances,
   consistent component vocabulary, density where users need it.
2. **Each person sees their own work.** Row-level scoping is a clarity feature, not just security.
   A member's board is theirs alone; the CEO's is everything.
3. **Honest state, never punitive.** Overdue is derived and factual (past due and not Done or
   Reviewed), never stored, never a guilt mechanism.
4. **Nothing is ever lost.** Archive and restore, never hard-delete. Reversibility builds trust;
   destructive actions get friction proportional to consequence.
5. **Familiar where it helps, better underneath.** ClickUp's layout wins on familiarity; we raise
   the bar on contrast, spacing, motion, and accessibility beneath it.

## Accessibility & Inclusion

- WCAG 2.2 AA. Body text contrast >=4.5:1, large text >=3:1, including placeholder and muted text.
- Full keyboard operability for the board: focus, move cards, open detail, navigate views.
- `prefers-reduced-motion` honored on every transition (crossfade or instant fallback).
- Dark theme for v1, matching Noel's ClickUp screenshots (a dark blue-gray surface with an
  indigo-violet brand). Contrast verified on dark surfaces. Color is never the sole carrier of
  status or priority (pair with text or icon). A light theme can return later via tokens.
- International team: plain language, store UTC and render per-user time zone.
