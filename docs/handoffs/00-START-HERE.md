# Handoff 00 — Project bootstrap & Section 0 entry   (status: COMPLETE — planning only, no code yet)

> This file is self-contained. A fresh chat needs **only this file** to start building.
> Read it top to bottom, then begin **Section 0** (§7). Do not re-read prior chat history.

---

## 1. What this project is
**Halevora Tasks** — a faithful, self-hosted **one-to-one clone of ClickUp's task/Kanban (Board) section** for the Halevora team. Source brief = WhatsApp voice notes + ClickUp screenshots (`C:\Users\david\Downloads\Noel`). This is a **NEW standalone repo** at `C:\Projects\halevora-tasks` — unrelated to the `halevora-monitor` repo.

Goal: match ClickUp's **layout and mechanics**; craft/quality is governed by the `impeccable` + `intent` skills (and `stop-slop` for copy). ClickUp's look wins on layout; impeccable governs contrast/spacing/motion/a11y underneath.

## 2. Stack (decided)
- **Next.js (App Router) + TypeScript** — UI, API routes, server actions in one repo.
- **Prisma** ORM over **Supabase Postgres**.
  - Use the **pooled** connection for normal queries (`DATABASE_URL`).
  - Use the **direct/session** connection (`DIRECT_URL`, port 5432) for the realtime `LISTEN/NOTIFY` worker — Supabase's transaction pooler can't `LISTEN`.
- **Auth.js (NextAuth) Credentials** — own `User` table (NOT Supabase Auth). Roles: `CEO` | `MEMBER`.
- **Realtime:** SSE + Postgres `NOTIFY` (chat + live board). No Pusher/Ably.
- **Rich text:** Tiptap. **Storage:** Supabase Storage (attachments). **Theme:** dark (matches
  Noel's ClickUp screenshots; token architecture allows a light theme later).
- Validate every section with `npm run typecheck` + `npm test` + a focused preview check.

## 3. Naming
- **Board** = a column/section you create (Innovations, Client success, Lucky Phone Farm, Meta Ads…). ClickUp calls this a List. Each Board has its own chat.
- **Task** = a card; belongs to one Board; has a **Status**.
- **Status** = `TODO → IN_PROGRESS → DONE → REVIEWED`. **Overdue is DERIVED** (past due-date AND not Done/Closed), never stored. **Reviewed** leaves the board into a separate Reviewed view.

## 4. TWO load-bearing decisions (do not "fix" these to match ClickUp)
1. **Visibility is custom row-level scoping, enforced server-side.** CEO sees ALL tasks; a MEMBER sees only tasks assigned to them — but any member can assign to anyone. (ClickUp's Member role does NOT do this; it shows all public items. Do not copy ClickUp's role model.)
2. **"Status on recur" is configurable, default `TODO`.** When a recurring task recurs, the new instance resets to To Do. (ClickUp's modern engine forces a "New" status; only its legacy engine let you choose — the brief wants the legacy behavior.)

## 5. v1 scope (LOCKED)
**Core (brief):** Boards-as-columns · Tasks with TODO→DONE→REVIEWED (+IN_PROGRESS) · derived Overdue · Reviewed→separate section · multiple assignees · ClickUp-style date/calendar picker · recurring tasks (daily/weekly/monthly/yearly/custom; trigger = on status-change OR on schedule; status-on-recur configurable default TODO; spawn fresh copy, old one leaves board) · task detail panel (Tiptap rich-text description, subtasks, time estimate, tags, custom fields incl. star Rating + % slider, comments + activity feed) · **per-board chat** · multi-sort · quick filters · views (Board / My Tasks / All-CEO / Today / Reviewed / Calendar).

**★ Added to v1 (from research — all approved):** notifications + inbox · @mentions · global search · per-task activity log · attachments (Supabase Storage) · **archive/restore (soft-delete only — never hard-delete)** · time zones (store UTC, render per-user) · persisted drag-reorder.

**○ Added:** Priority field (Urgent/High/Normal/Low) with sort/filter.

**◆ Pulled into v1 (CEO request, 2026-06-29):** task dependencies (blocking / waiting-on links) · checklists · bulk edit · reusable task templates · **automation builder** (build-your-own trigger/condition/action rules engine + editor).

**◇ Added from source review (Noel's voice notes + screenshots, 2026-06-29):** **dark theme** one-to-one with the screenshots · explicit **start date** (alongside due date) · **"Add Tasks Quickly"** fast-entry view (enter-to-create many tasks) · **workspace breadcrumb + left project selector** chrome (e.g. "Team Space / Halevora") · **AI-assisted description** (Tiptap editor with a Claude-powered writing prompt) · **richer Calendar** (week/day views + drag task to a date) · **custom/saved views** ("Add view") + a Quick view. ClickUp status menu grouping (Not started: TODO/OVERDUE · Active: IN_PROGRESS · Done · Closed: REVIEWED) and the date-picker quick choices (Today/Later/Tomorrow/This weekend/Next week/2 weeks/4 weeks) are part of the one-to-one match.

**Backlog (NOT v1):** time-tracking timer (stopwatch), WIP limits, watchers/followers, dedicated **offline mobile app** (the web app IS mobile-responsive per §13 Polish; only a separate installable offline PWA is deferred), deep custom-fields engine (build only the field types v1 needs: text, number, checkbox, date, dropdown, labels, rating, people, slider/manual_progress).

## 6. Build partitions (one chat each, ~300–400k token budget)
After EACH section, write `docs/handoffs/NN-<slug>.md` (template in §8) and stop. Next chat reads only that handoff.

| # | Section | Depends on |
|---|---|---|
| 0 | Scaffold + design system (Next.js+TS+Prisma+Auth.js, Supabase wiring, base layout, **dark** OKLCH tokens, `/intent` context + `/impeccable init`, scripts) | — |
| 1 | Data model + Prisma migrations + seed (incl. **start date**, dependencies, checklists, templates, automation-rule schema, workspace/project entities) | 0 |
| 2 | Auth + permissions (login, roles, **row-level scoping helper**, admin user mgmt) | 1 |
| 3 | Board view / Kanban core (columns, cards, status badges, derived Overdue, create/move, persisted drag-reorder, workspace breadcrumb + project selector) | 2 |
| 4 | Task detail A (status, assignees, start+due dates+calendar, priority, tags, Tiptap description with AI-assisted writing prompt, subtasks, checklists) | 3 |
| 5 | Task detail B (custom fields, attachments, comments + activity log) | 4 |
| 6 | Task dependencies (blocking / waiting-on links, cycle prevention, board+detail UI, gate Done while blocked) | 4 |
| 7 | Recurring tasks (config UI + inline-on-status engine + scheduled worker) | 4 |
| 8 | Automation builder (trigger/condition/action engine + builder UI + execution worker; shares scheduled-worker infra with §7). Largest section: likely splits 8a engine / 8b builder-UI via a PARTIAL handoff | 1, 3, 7 |
| 9 | Views + sort/filter (My Tasks, All-CEO, Today, Reviewed, Calendar with week/day + drag-to-date, **Add Tasks Quickly** fast-entry, multi-sort, quick filters, custom/saved views + Quick view) | 3 |
| 10 | Templates + bulk edit (create-from-template UI; multi-select + batch mutations) | 9 |
| 11 | Realtime + per-board chat (SSE + Postgres NOTIFY, live board, presence) | 2 |
| 12 | Notifications + @mentions + global search | 11 |
| 13 | Polish (impeccable audit/polish, include a11y, transpose mobile, fortify edge/empty states, stop-slop copy) | all |

Spine is 0→1→2→3. Sections 9 and 11 are independent of each other; §8 (automation) is the biggest and may run across two chats. **Numbering changed from the original 11-section plan (CEO scope expansion, 2026-06-29):** dependencies (§6) and automation (§8) are new; templates + bulk edit became §10; realtime / notifications / polish shifted to §11 / §12 / §13.

## 7. SECTION 0 — your task for the NEXT chat
**Goal:** a running, empty, well-structured app skeleton with the design system established.

> **Pre-coding setup is DONE (2026-06-29) — do NOT redo it:**
> - **superpowers** plugin installed + enabled (user scope). Use its brainstorming → writing-plans → TDD → verification-before-completion workflow for this section.
> - **Design skills installed GLOBALLY** at `~/.claude/skills/` (impeccable + 16 intent-family + stop-slop + caveman). Available regardless of cwd — do not copy them into this repo.
> - **Project skills** already in `.claude/skills/`: `halevora-qa-gate`, `halevora-permissions-audit`, `halevora-recurrence-audit`, `halevora-realtime-debug`. Run `halevora-qa-gate` before the handoff.
> - **DB = Supabase** (Railway was considered and rejected — keep built-in Storage + free tier). Project ref `ggpubtmydqiywxlfpckx`, region eu-north-1; strings via Connect → ORMs → Prisma.
> - **GitHub repo** already created: `supporteraphina/halevora-tasks` (currently EMPTY — no `main` branch yet; this section's first push creates it). Supabase↔GitHub integration + GitHub MCP become usable after that first push.
> - Browser checks: use the connected **chrome-devtools MCP**; add Playwright as an in-repo test dep here.

Steps:
1. `cd C:\Projects\halevora-tasks`. `git init`. Scaffold Next.js (App Router, TS, ESLint). Add Prisma, Auth.js, Tiptap deps.
2. Wire Supabase: create `.env` (gitignored) + `.env.example` with `DATABASE_URL` (pooled) and `DIRECT_URL` (session). Prisma `datasource` uses both.
3. Run `/intent` (context mode) to capture users/constraints/ethics, then `/impeccable init` to generate `PRODUCT.md` + `DESIGN.md` + design tokens (light theme, OKLCH; this is app/tool UI → register = `product.md`, NOT brand). It will hit `NO_PRODUCT_MD` first — that's expected; finish init. **CAVEAT (global install):** impeccable's SKILL.md invokes its scripts via the project-relative path `.claude/skills/impeccable/scripts/...`, which does NOT exist here — run them from `~/.claude/skills/impeccable/scripts/...` instead (verified working).
4. Base app shell: top nav (Board / My Tasks / Calendar / Chat tabs as placeholders), CSS-variable token file, empty board route.
5. Scripts in `package.json`: `dev`, `build`, `typecheck`, `test`, `db:migrate`, `db:seed`. Confirm `npm run typecheck` + `npm run build` pass on the empty skeleton.
6. Write `docs/handoffs/01-data-model.md` describing Section 1 entry, then stop.

**Needed from the user before/within Section 0:**
- Supabase **pooled + direct** connection strings — user has them (Connect → ORMs → Prisma gives `DATABASE_URL` port 6543 + `DIRECT_URL` port 5432, both for ref `ggpubtmydqiywxlfpckx`); user pastes the password-filled versions into `.env` at section start, or say "use `.env.example` placeholders" to proceed.
- **Team roster + who is CEO** (Noel Pollak = CEO/NP from screenshots; others unnamed) — seed placeholders to rename later.

**Gotchas:** keep `src/domain` style logic pure/testable; ESM `NodeNext` import idiom if mirroring halevora-monitor conventions; do NOT commit `.env`.

## 8. Handoff template (copy for every section)
```md
# Handoff NN — <section>   (status: COMPLETE | PARTIAL)
## 1. Bootstrap (read only these)
- docs/handoffs/00-START-HERE.md · this file · files the next section edits: <paths>
## 2. What this section built
## 3. Files added/changed  (path — one line)
## 4. State of the world
- Migrations applied · Env needed · How to run · Verified (typecheck/test/clicked)
## 5. Open issues / deferred (with code TODO markers)
## 6. NEXT SECTION (NN+1): goal · entry point · first 3 steps · gotchas
```
If a section runs hot mid-chat: stop at a clean sub-boundary, write the handoff as `status: PARTIAL` with the exact resume point.

## 9. Reference docs
- `RESEARCH.md` (same folder, one level up: `docs/`) — cited ClickUp teardown + gap analysis. Read once if you need ground-truth on ClickUp behavior; skim after.
- Source brief (voice notes + screenshots): `C:\Users\david\Downloads\Noel`.
- Persistent project memory: `…\memory\halevora-tasks-project.md`.

## 10. Token discipline
New chat = read this file + the latest handoff + only the files you edit. Use Grep/targeted reads, not whole-tree reads. Verify per-section, not whole-app. Don't re-read prior handoffs.
