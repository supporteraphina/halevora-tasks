# Section 0 — Scaffold + Design System (design spec)

Status: approved (CEO delegated technical calls, 2026-06-29).
Source of truth for scope: `docs/handoffs/00-START-HERE.md` §7.

## Goal
A running, empty, well-structured Halevora Tasks skeleton with the design system
established. Nothing functional to click beyond an empty board shell. This is the slab the
other 13 sections build on.

## In scope
- `git init` + `.gitignore`.
- Next.js (App Router, TypeScript, ESLint) scaffold.
- Dependencies installed: Prisma, Auth.js (next-auth), Tiptap (deps only; wired in later sections).
- Supabase wiring: `.env` (gitignored) + `.env.example` with `DATABASE_URL` (pooled 6543) and
  `DIRECT_URL` (session 5432). Prisma `datasource` references both. No migrations run (Section 1).
- Design system via `/intent` (context) + `/impeccable init`: `PRODUCT.md`, `DESIGN.md`, OKLCH
  light-theme tokens. Product register (app/tool UI), not brand.
- Base app shell: top nav (Board / My Tasks / Calendar / Chat placeholders), CSS-variable token
  file, empty board route with a zero-state.
- `package.json` scripts: `dev`, `build`, `typecheck`, `test`, `test:e2e`, `db:migrate`, `db:seed`.
- Test harness: Vitest (unit/domain) + Playwright (e2e smoke).
- `docs/handoffs/01-data-model.md` written for the next chat.

## Out of scope (later sections)
- Prisma models + migrations + seed (Section 1).
- Auth.js configuration, routes, login (Section 2).
- Tiptap usage, any real board/task logic (Sections 3+).

## Key decisions
1. **Scaffold method:** run `create-next-app` in a throwaway temp dir, then copy generated files
   into the repo alongside existing `docs/` + `.claude/`. Avoids the non-empty-dir refusal and the
   Windows interactive prompts; yields canonical, version-correct config.
2. **Module resolution:** keep Next.js defaults (`"moduleResolution": "bundler"`, `@/*` alias).
   Do NOT adopt halevora-monitor's NodeNext `.js`-extension idiom — Next.js owns resolution and
   NodeNext fights it. `src/domain/` stays pure, framework-free, Vitest-tested.
3. **Theme:** light only. Tokens in OKLCH from `/impeccable init`.
4. **impeccable scripts caveat:** the skill is installed globally; invoke its scripts from
   `~/.claude/skills/impeccable/scripts/...`, not the project-relative path.
5. **Browser checks:** the connected `chrome-devtools` MCP for in-session verification; Playwright
   for the committed e2e smoke. `npm test` stays Vitest-only (fast, DB-free).
6. **No DB needed for Section 0.** `prisma generate` reads the schema without a connection;
   placeholders in `.env` are fine until the CEO fills the real password before Section 1.

## Repo structure (target)
```
src/
  app/
    layout.tsx              # root layout: imports tokens.css + globals.css; renders AppShell
    page.tsx               # redirect to /board
    board/page.tsx         # empty board route (zero-state)
    my-tasks/page.tsx      # placeholder
    calendar/page.tsx      # placeholder
    chat/page.tsx          # placeholder
  components/AppShell.tsx   # top nav: Board / My Tasks / Calendar / Chat
  domain/
    status.ts              # Status model + derived isOverdue (pure)
    status.test.ts         # Vitest unit tests (written first)
  lib/prisma.ts            # PrismaClient singleton (empty client until Section 1)
  styles/tokens.css        # OKLCH light-theme tokens (from /impeccable init)
  styles/globals.css       # base styles via CSS variables
prisma/schema.prisma       # datasource(DATABASE_URL+DIRECT_URL) + generator ONLY
e2e/board.spec.ts          # Playwright smoke
.env / .env.example
PRODUCT.md · DESIGN.md
docs/handoffs/01-data-model.md
```

## TDD plan
A scaffold has little logic, so prove both test layers on the one pure thing Section 0 owns:
1. **Vitest:** write `src/domain/status.test.ts` first for the `Status` union
   (`TODO | IN_PROGRESS | DONE | REVIEWED`) and `isOverdue(task, now)` — true when a due date is
   past AND status is not `DONE`/`REVIEWED`. Implement `status.ts` to green. (§3 marks Overdue
   "DERIVED, never stored"; this is the canonical seed Section 3 consumes.)
2. **Playwright:** `e2e/board.spec.ts` — `/board` loads, top nav renders all four tabs, empty-state
   visible. Make it pass with the shell.

## Validation gates (Section 0 "done")
- `npm run typecheck` passes (clean skeleton).
- `npm test` (Vitest) green.
- `npm run build` succeeds.
- Browser smoke via chrome-devtools MCP: board route + nav render, no console errors.
- `halevora-qa-gate` project skill run before the handoff.
- `01-data-model.md` written; nothing committed in `.env`.

## Risks / notes
- `create-next-app` version drift: pin nothing unusual; accept its current stable App Router output.
- The automation builder and dependencies (new v1 scope) only touch Section 0 via the eventual
  data model; no Section 0 change needed beyond awareness.
