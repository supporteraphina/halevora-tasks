# Handoff 01 — Data model (Section 1 entry)   (Section 0 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (project spec, scope, partition)
- this file
- files Section 1 edits: `prisma/schema.prisma`, `prisma/` (new `migrations/`, new `seed.ts`),
  `src/domain/` (enums/types to mirror), `package.json` (seed config), `.env` (real password)
- reference: `PRODUCT.md`, `DESIGN.md` (already written; do not regenerate)

## 2. What Section 0 built
A running, empty, well-structured Next.js skeleton with the design system in place. No business
logic yet beyond one pure domain helper. Stack: Next.js 16 (App Router, TS) + Prisma 6 +
`@prisma/client`, `next-auth@beta` and Tiptap installed (deps only, unused), Vitest + Playwright.

## 3. Files added/changed
- `package.json` / `package-lock.json` — name `halevora-tasks`; scripts `dev build start lint
  typecheck test test:e2e db:migrate db:seed`; deps installed.
- `.gitignore` — Next default + `!.env.example`, `/test-results/`, `/playwright-report/`.
- `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `next-env.d.ts` — scaffold defaults (bundler resolution, `@/*` alias).
- `prisma/schema.prisma` — datasource (DATABASE_URL pooled + DIRECT_URL session) + generator only, NO models.
- `src/lib/prisma.ts` — PrismaClient singleton (default export).
- `.env.example` (committed) / `.env` (gitignored) — both connection strings, password = `[YOUR-PASSWORD]`.
- `PRODUCT.md`, `DESIGN.md`, `docs/intent-context.md` — strategy + visual system + intent context.
- `src/styles/tokens.css` — OKLCH light-theme tokens (color roles, type scale, spacing, radii, shadows, z-index, motion).
- `src/styles/globals.css` — reset + base styles via tokens; reduced-motion rule.
- `src/components/AppShell.tsx` (+ `.module.css`) — sticky top nav (Board / My Tasks / Calendar / Chat), active-tab state.
- `src/components/Placeholder.tsx`, `src/components/page.module.css` — shared page + empty-state styles.
- `src/app/layout.tsx` — imports styles, renders AppShell, metadata title.
- `src/app/page.tsx` — redirects `/` → `/board`.
- `src/app/board/page.tsx` — empty-board zero-state ("No boards yet" + New board button placeholder).
- `src/app/{my-tasks,calendar,chat}/page.tsx` — placeholder pages.
- `src/domain/status.ts` (+ `status.test.ts`) — `Status` union, `STATUSES`, `isClosed`, derived `isOverdue` (TDD, 6 tests).
- `vitest.config.ts` (scopes unit tests to `src/`), `playwright.config.ts`, `e2e/board.spec.ts` (2 smoke tests).

## 4. State of the world
- **Migrations:** none yet (Section 1 creates the first). Schema has zero models.
- **Env needed:** real Supabase password in `.env` (`DATABASE_URL` port 6543, `DIRECT_URL` port 5432,
  ref `ggpubtmydqiywxlfpckx`). Section 0 ran no DB calls, so the placeholder was fine until now.
- **How to run:** `npm install` → `npx prisma generate` → `npm run dev` (http://localhost:3000,
  `/` redirects to `/board`). `npm test` (Vitest), `npm run test:e2e` (Playwright, auto-starts dev).
- **Verified:** `npm run typecheck` clean · `npm test` 6/6 · `npm run build` clean (6 routes) ·
  `npm run test:e2e` 2/2 · chrome-devtools smoke on `/board` (nav + empty state, no console errors,
  desktop + 390px mobile screenshots captured).

## 5. Open issues / deferred
- **Prisma pinned to v6** (not v7). v7 dropped schema-level `url`/`directUrl` for a `prisma.config.ts`
  + driver-adapter model; pinned v6 for stability and plan fidelity. Revisit only if a v7 feature is needed.
- **`next-auth@beta` (v5) installed but unused** — Section 2 confirms the version and wires it.
- **`db:seed` script** is `prisma db seed` but has no seed file or `prisma.seed` config yet — Section 1 adds
  `prisma/seed.ts`, the `"prisma": { "seed": ... }` block in package.json, and a TS runner (e.g. `tsx`).
- **"New board" button** on `/board` is a non-functional placeholder (wired in Section 3).
- **No project `CLAUDE.md`** and **live mode not configured** — optional, can add later; neither blocks work.
- Benign CRLF warnings on commit (Windows). Add a `.gitattributes` later if desired.
- Not pushed to GitHub yet (first push creates `main` on `supporteraphina/halevora-tasks`). Work is on
  branch `section-0-scaffold`; initial empty commit is on `main`.

## 6. NEXT SECTION (Section 1): Data model + migrations + seed
**Goal:** full Prisma schema for v1, the initial migration applied to Supabase, and an idempotent seed.

**Entry point:** `prisma/schema.prisma` (extend the existing datasource/generator).

**First 3 steps:**
1. Put the real Supabase password in `.env` (both URLs). Confirm connectivity: `npx prisma validate`,
   then a trivial `npx prisma migrate dev --name init` once the first models exist.
2. Model the schema: `User` (+ `Role` enum CEO|MEMBER), `Board` (+ board chat messages), `Task`
   (`Status` enum `TODO|IN_PROGRESS|DONE|REVIEWED` — mirror `src/domain/status.ts`; `priority`,
   `dueAt` UTC, soft-delete `archivedAt`, ordering field), Task↔User assignees (many-to-many),
   `Subtask`, `Checklist`/`ChecklistItem`, `Tag`, `Comment`, `ActivityLog`, `Attachment`, custom
   fields (text/number/checkbox/date/dropdown/labels/rating/people/slider), `TaskDependency`
   (with cycle-prevention in app logic later), `TaskTemplate`, `AutomationRule`
   (trigger/condition/action), and recurrence config (cadence, trigger, status-on-recur default TODO).
3. Run `npm run db:migrate`, add `prisma/seed.ts` (+ `prisma.seed` in package.json + `tsx` dev dep),
   seed Noel Pollak as CEO plus placeholder members and 2-3 boards; run `npm run db:seed`.

**Gotchas:**
- Migrations use `DIRECT_URL` (5432); the pooler (6543) cannot run migrations. Prisma uses `directUrl` automatically.
- Keep the Prisma `Status` enum identical to `src/domain/status.ts`. Keep `src/domain` pure/tested.
- **Overdue is derived, never a column.** **Soft-delete only (`archivedAt`), never hard-delete.**
- Model `Task.assignees` carefully — Section 2's row-level scoping filters members to their assigned tasks.
- Run `halevora-qa-gate` before writing the Section 2 handoff.
