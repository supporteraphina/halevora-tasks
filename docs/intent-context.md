# Halevora Tasks — Project Context (Intent, context mode)

Generated 2026-06-29 from `docs/handoffs/00-START-HERE.md` and the ClickUp teardown in
`docs/RESEARCH.md`. No direct user research yet; assumptions are flagged and should be validated
with the team.

## Users
Behavior and context, not demographics.

- **CEO (Noel Pollak).** Oversees all work. Sees every task on every board, assigns and reviews,
  needs full cross-team visibility at a glance. Decision authority for the product.
- **Team member (VA / staff).** Works a personal queue. Opens "My Tasks," moves cards through
  statuses, receives work assigned by anyone, coordinates through per-board chat. Likely
  distributed across time zones; uses both desktop and a phone browser. Mixed technical literacy.

Their shared goal: coordinate and track the team's work in a familiar ClickUp-style board, with
each member focused on a private, uncluttered view of their own tasks.

Today they use ClickUp. This replaces it with a self-hosted, tailored clone they control.

## Product
- Internal task / Kanban tool. A faithful clone of ClickUp's Board section, tailored to Halevora.
- No revenue model; an internal productivity tool, cost-minimized (free service tiers). Explicitly
  not engagement-driven.
- Platform: web (Next.js App Router), responsive down to phones. Light theme only.
- Maturity: greenfield v1, built in 14 sections.

## Constraints
- **Technical:** Next.js + Prisma 6 + Supabase Postgres; Auth.js (own User table, Credentials);
  realtime via SSE + Postgres LISTEN/NOTIFY; Tiptap rich text; Supabase Storage. Server-side
  row-level scoping is load-bearing and must never be enforced on the client alone.
- **Organizational:** AI-driven, section-by-section build; CEO is the single approver.
- **Temporal:** phased delivery, one chat per section (~300-400k tokens).
- **Data safety:** store UTC, render per-user; soft-delete only (never hard-delete).

## Ethical stance
This is an internal work tool, so consumer dark patterns mostly do not apply, but the principles
still bind design choices.

- **Autonomy and reversibility.** No manipulation. Destructive actions get friction proportional to
  consequence; archive + restore (soft-delete) is a locked decision, so deletion is recoverable.
- **Real conditions.** Time zones (store UTC, render local), phone and desktop browsers, slow
  connections, and interrupted sessions that must resume cleanly.
- **Visible intent.** Honest statuses; Overdue is derived (past due and not Done/Reviewed), never a
  punitive surprise and never stored. A per-task activity log makes who-changed-what transparent.
- **Privacy by default.** Row-level scoping means a member sees only tasks assigned to them,
  enforced server-side. This protects member focus and privacy; the CEO's full visibility is
  legitimate oversight, transparent to the team.
- **Honest notifications.** Notifications and the inbox fire on real events (assignment, @mention,
  due) — avoid Notification Spam and Nagging. No streaks, fake urgency, or infinite-scroll traps.

## Success
- The team prefers it to ClickUp: members find and finish their tasks fast; the CEO has complete
  visibility; recurring work runs reliably; nothing is ever lost; the board feels as fluent as
  ClickUp's.

## Gaps and assumptions
- No primary research; context is drawn from the ClickUp teardown and the CEO's brief (voice notes
  + screenshots). Validate with the team when possible.
- Where an ethical choice was unstated, this document defaults to user protection.
