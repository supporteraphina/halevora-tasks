# Handoff 03 — Board view / Kanban core (Section 3 entry)   (Section 2 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (project spec, scope, partition; esp. §4 two load-bearing decisions)
- this file
- files Section 3 edits/reads:
  - `src/lib/scope.ts` — **compose `taskWhereForCurrentUser()` into every Task read** (load-bearing)
  - `src/domain/scope.ts` — pure where-builder + `canSeeTask` predicate (don't duplicate; reuse)
  - `src/domain/status.ts` (`STATUSES`, `isOverdue`, `isClosed`) + `src/domain/priority.ts`
  - `prisma/schema.prisma` (Task / Board / Project / Workspace; `order` Float for drag-reorder)
  - `src/lib/prisma.ts`, `src/components/AppShell.tsx`, `src/styles/tokens.css`
  - `src/app/board/page.tsx` (replace the Section 0 placeholder)
- reference: `PRODUCT.md`, `DESIGN.md`

## 2. What Section 2 built (auth + permissions)
Working Auth.js v5 (`next-auth@beta`) login, role-bearing sessions, the load-bearing row-level
task-scoping helper, route protection, and a CEO-only user-management surface.

- **Auth (Credentials + JWT, no adapter tables / no new migration).**
  - `src/auth.ts` — `NextAuth({...})` with a Credentials provider: looks up `User` by
    normalized email, `bcrypt.compare(password, passwordHash)`, returns
    `{ id, name, email, image, role, timezone }`. Exports `handlers`, `auth`, `signIn`, `signOut`.
  - `src/auth.config.ts` — edge-safe, providerless config: `pages.signIn = "/login"` plus `jwt`
    + `session` callbacks that carry `id`/`role`/`timezone` onto the token and `session.user`.
  - `src/app/api/auth/[...nextauth]/route.ts` — re-exports `GET`/`POST` from `handlers`.
  - `src/types/next-auth.d.ts` — augments `Session`/`User`/`JWT` with `id`/`role`/`timezone`.
- **Route protection — `src/proxy.ts` (NOT `middleware.ts`).** Next.js 16 renamed the convention
  to **`proxy`**; with a `src/` dir it must live at `src/proxy.ts`. Uses the explicit
  `auth((req) => …)` form (the implicit `authorized` callback silently did NOT fire under
  Next 16 / Turbopack — see §5). Gates every route except `/login` and `api/auth`/static;
  bounces signed-in users off `/login` → `/board`, and unauthenticated users → `/login`.
- **Scoping helper (load-bearing, TDD).**
  - `src/domain/scope.ts` (pure): `taskScopeWhere({ role, userId })` → `{}` for CEO,
    `{ assignees: { some: { id: userId } } }` for MEMBER. Plus `canSeeTask(actor, { assigneeIds })`
    for in-memory checks (realtime/already-fetched lists). 9 tests in `scope.test.ts` (CEO,
    MEMBER, per-member isolation, subtask case, single-row predicate).
  - `src/lib/scope.ts` (server glue): `currentActor()`, `requireActor()`, `requireRole(role)`,
    and `taskWhereForCurrentUser()` — reads the Auth.js session and feeds the pure builder.
- **CEO-only admin** `/admin/users` (`src/app/admin/users/`): server-side role gate in
  `page.tsx` (`currentActor()` → redirect non-CEO to `/board`); create / rename / set-role /
  reset-password server actions, each guarded by `requireRole("CEO")` and using pure
  `validateNewUser` / `isRole` from `src/domain/users.ts` (7 tests). Set-role refuses to demote
  the last CEO.
- **Login UI** `src/app/login/` (page + `LoginForm` client component using `useActionState`),
  **sign-out** server action, and a `UserMenu` chip in the AppShell (name, role badge,
  CEO-only Admin link). `AppShell` hides its chrome on `/login`; root `layout.tsx` now reads the
  session and passes `{ name, role }` to the shell.
- **Env:** `AUTH_SECRET` added to `.env` (real, gitignored) and `.env.example` (placeholder).

## 3. Files added/changed
- `src/auth.ts` — NextAuth v5 config: Credentials provider, JWT sessions (NEW).
- `src/auth.config.ts` — edge-safe config: signIn page + jwt/session callbacks (NEW).
- `src/proxy.ts` — route protection (Next 16 "proxy" convention; NOT middleware.ts) (NEW).
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js GET/POST handlers (NEW).
- `src/types/next-auth.d.ts` — Session/User/JWT augmentation with id/role/timezone (NEW).
- `src/domain/scope.ts` + `scope.test.ts` — pure task where-builder + canSeeTask (NEW, TDD).
- `src/domain/users.ts` + `users.test.ts` — role guard, email normalize, validateNewUser (NEW, TDD).
- `src/lib/scope.ts` — session-reading server glue (currentActor/requireRole/taskWhereForCurrentUser) (NEW).
- `src/app/login/page.tsx` · `LoginForm.tsx` · `actions.ts` · `signout.ts` · `login.module.css` — login + sign-out (NEW).
- `src/app/admin/users/page.tsx` · `UsersAdmin.tsx` · `actions.ts` · `admin.module.css` — CEO user mgmt (NEW).
- `src/components/UserMenu.tsx` + `UserMenu.module.css` — signed-in chip + sign-out (NEW).
- `src/components/AppShell.tsx` — hides chrome on /login; renders UserMenu; takes `user` prop (CHANGED).
- `src/app/layout.tsx` — reads `auth()` session, passes user to AppShell (CHANGED).
- `.env` / `.env.example` — `AUTH_SECRET` added (real value gitignored; placeholder in example).

## 4. State of the world
- **Migrations:** unchanged — `20260629020818_init_data_model` only. Credentials+JWT needs no
  Account/Session/VerificationToken tables, so Section 2 added **no migration**.
  `npx prisma migrate status` → "Database schema is up to date".
- **Env needed:** `DATABASE_URL`, `DIRECT_URL`, **`AUTH_SECRET`** (all in `.env`). Generate a
  secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`,
  then open `/login` and sign in. Seeded logins (password `halevora`): `noel@halevora.com` (CEO),
  `member1@halevora.com`..`member3@halevora.com` (MEMBER).
- **Verified:**
  - `npm run typecheck` clean · `npm test` 25/25 (was 9; +16 new in scope/users) ·
    `npm run build` clean (9 routes + Proxy/Middleware) · `npx prisma validate` ok ·
    `migrate status` in sync.
  - **Auth lifecycle (curl + browser):** CEO + MEMBER login each yield a session with the right
    `id`/`role`/`timezone`; bad password → no session, redirect to `/login?error=CredentialsSignin`.
  - **Route protection:** unauthenticated `/board`,`/my-tasks`,`/calendar`,`/chat`,`/admin/users`,`/`
    all 302→`/login`; `/login` is 200; signed-in user on `/login` 302→`/board`.
  - **CEO-only enforced server-side:** MEMBER hitting `/admin/users` 307→`/board` (not just UI hidden).
  - **Browser smoke (chrome-devtools MCP):** logged in as Noel, redirected to `/board`, opened
    `/admin/users`, **created a member through the UI** (list 4→5, server action + revalidate),
    signed out → back to `/login`, then `/board` re-gated. No console errors. Screenshot saved to
    the session scratchpad (outside the repo).
  - Test user `dana.test@halevora.com` created during smoke was deleted; DB back to 4 seed users.
  - No `.env` tracked (`git check-ignore .env` confirms); real `AUTH_SECRET` not in any tracked file.

## 5. Open issues / deferred
- **Next 16 convention gotcha (resolved, but know it):** route protection MUST be `src/proxy.ts`.
  A root `middleware.ts` (and even `src/middleware.ts`) compiled but its function **never ran**
  under `next dev`/Turbopack (no redirect, no logs); the implicit NextAuth `authorized` callback
  likewise never fired. Switching to `src/proxy.ts` with the explicit `auth((req)=>…)` form fixed
  it. Do not reintroduce a `middleware.ts` — Next errors if both exist.
- **Scoping is wired but not yet exercised:** there are currently **zero** `prisma.task.*` reads in
  `src/` (board page is still the placeholder). Section 3 is the first consumer — every Task read
  MUST compose `taskWhereForCurrentUser()` (or `taskScopeWhere`) into its `where`. A bare
  `prisma.task.findMany` in a handler is a data leak. Run `halevora-permissions-audit` after Section 3.
- **`requireActor`/`requireRole` throw plain `Error("UNAUTHENTICATED"|"FORBIDDEN")`.** Pages
  currently redirect via `currentActor()` instead; if Section 3 calls `requireRole` directly in a
  route handler, map those throws to 401/403 responses (don't surface a 500).
- Admin set-role guards the "last CEO" case; it does not yet prevent a CEO from demoting
  *themselves* when another CEO exists (intentional — allowed). No user **delete** (soft or hard)
  in admin yet; out of scope for §2.
- `server-only` package is not installed, so `src/lib/scope.ts` doesn't import it; the `auth()`
  call keeps it server-bound in practice. Add the dep if you want a hard compile-time guard.

## 6. NEXT SECTION (Section 3): Board view / Kanban core
**Goal:** the real Board — status columns of task cards for a selected board, with status badges,
**derived** Overdue, create-task, move-between-columns, and **persisted drag-reorder** within a
column. Plus the workspace breadcrumb ("Team Space / Halevora") + a left project/board selector.
All Task reads scoped by the current user (CEO all; MEMBER only assigned).

**Entry point:** replace `src/app/board/page.tsx` (server component) — fetch the workspace →
project → boards, and the selected board's top-level tasks
(`parentId: null`, `archivedAt: null`) **scoped** via
`{ AND: [ await taskWhereForCurrentUser(), { boardId, parentId: null, archivedAt: null } ] }`.
Group by `status` using `STATUSES` from `src/domain/status.ts`.

**First 3 steps:**
1. Read `src/lib/scope.ts`, `src/domain/status.ts`, `prisma/schema.prisma` (Task/Board ordering:
   `order` is a Float per `(board,status)` column). Build a server data loader that returns the
   board list + the selected board's scoped tasks grouped into the four status columns, deriving
   Overdue with `isOverdue(task, new Date())` (never store it). Add a `?board=<id>` selector
   (default the first board) + the "Team Space / Halevora" breadcrumb.
2. Render columns + cards (CSS modules + tokens; dark theme; reuse the card/badge styling idiom
   from `page.module.css`/`admin.module.css`). Card shows title, status badge, priority dot,
   assignee avatars, due date with the Overdue treatment (use `--status-overdue*`,
   `--prio-*`, `--status-*` tokens). Add "New task" (create with default `status: TODO`,
   `order` = max+1 in the target column) via a server action; keep create idiomatic with
   `useActionState` like the login/admin forms.
3. Implement move + persisted drag-reorder: a server action that updates a task's `status`
   and/or `order` (fractional/midpoint ordering between neighbors so reorders are O(1) writes).
   Authorize every mutation server-side — a MEMBER may only move a task they can see
   (`canSeeTask` / re-query under scope); never trust the task id from the client.

**Gotchas:**
- **Scoping on every read** — board, card includes (assignees/subtasks), and any count. Compose
  `taskWhereForCurrentUser()`; do not hand-roll a second visibility rule.
- **Overdue is DERIVED**, not a column and not a stored status. Compute at render with
  `isOverdue`. The ClickUp status menu *groups* OVERDUE under "Not started" visually, but the
  stored `status` stays TODO/IN_PROGRESS.
- **REVIEWED leaves the board** into a separate Reviewed view (§9) — render the four columns but
  treat REVIEWED tasks as off the active board (or a collapsed/last column per the screenshots);
  confirm against `C:\Users\david\Downloads\Noel`.
- Subtasks are Tasks — filter `parentId: null` for the board grid; a subtask is visible per its
  **own** assignees (consistent with `taskScopeWhere`).
- `order` is a Float for cheap reordering — pick midpoints; plan an occasional renormalize if
  values collide. Persist on drop, not on hover.
- Run `halevora-permissions-audit` (it now has a real surface to audit) and `halevora-qa-gate`
  before writing the Section 4 handoff. Browser-smoke the board with the chrome-devtools MCP,
  including a second MEMBER account to prove a member can't see another member's task.
