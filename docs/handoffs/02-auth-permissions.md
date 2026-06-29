# Handoff 02 — Auth + permissions (Section 2 entry)   (Section 1 status: COMPLETE)

## 1. Bootstrap (read only these)
- `docs/handoffs/00-START-HERE.md` (project spec, scope, partition)
- this file
- files Section 2 edits: `prisma/schema.prisma` (maybe Auth.js adapter tables),
  `src/lib/prisma.ts`, new `src/lib/auth.ts` / `src/auth.ts`, `src/app/api/auth/[...nextauth]/`,
  login route under `src/app/(auth)/login/`, a `src/lib/scope.ts` row-level-scoping helper,
  `middleware.ts`, `.env` (auth secret)
- reference: `PRODUCT.md`, `DESIGN.md`

## 2. What Section 1 built (data model + migrations + seed)
Full v1 Prisma schema, the initial migration applied to Supabase, and an idempotent seed.

- **Schema** (`prisma/schema.prisma`): complete v1 model.
  - Enums: `Role` (CEO|MEMBER), `Status` (TODO|IN_PROGRESS|DONE|REVIEWED — mirrors
    `src/domain/status.ts`), `Priority` (URGENT|HIGH|NORMAL|LOW), `CustomFieldType`
    (TEXT|NUMBER|CHECKBOX|DATE|DROPDOWN|LABELS|RATING|PEOPLE|SLIDER), `Cadence`
    (DAILY|WEEKLY|MONTHLY|YEARLY|CUSTOM), `RecurrenceTrigger` (ON_STATUS_CHANGE|ON_SCHEDULE).
  - Hierarchy: `Workspace` → `Project` → `Board` (the "Team Space / Halevora" breadcrumb;
    Board = ClickUp List).
  - `User` (own table; `passwordHash`, `role`, `timezone`).
  - `Task`: `status`, `priority`, `startAt`+`dueAt` (UTC), `timeEstimate`, `order` (Float, for
    drag-reorder within a (board,status) column), `archivedAt` (soft-delete). **Subtasks are
    self-referential Tasks** via `parentId` (board queries filter `parentId = null`).
  - Relations: `assignees` (implicit m2m Task↔User — **the hinge for Section 2 scoping**),
    `tags` (implicit m2m), `Checklist`/`ChecklistItem`, `Comment`, `ActivityLog` (append-only),
    `Attachment`, `CustomField`/`CustomFieldValue`, `TaskDependency`, `TaskTemplate`,
    `AutomationRule`/`AutomationRunLog` (append-only), `RecurrenceRule` (1:1 with Task,
    `statusOnRecur` default TODO), `ChatMessage` (per board).
  - **`TaskDependency` is a single directed edge** `blocker → blocked` (blocker must close
    before blocked may be Done). "Waiting on" is the inverse view; no separate type enum.
- **Domain** (`src/domain/priority.ts` + test): `Priority` union mirror, `PRIORITIES`,
  `priorityRank`, `comparePriority` (3 tests, TDD). `status.ts` unchanged.
- **Seed** (`prisma/seed.ts`, runner `tsx`): Noel Pollak (CEO, `noel@halevora.com`) + 3
  placeholder members (`member1..3@halevora.com`), workspace "Halevora" → project "Halevora"
  → boards Innovations / Client Success / Meta Ads, 8 tasks spread across statuses/priorities
  (incl. one overdue, derived). **All seeded users share dev password `halevora`** (bcrypt
  hash). Idempotent (matches on natural keys; leaves existing rows alone).

## 3. Files added/changed
- `prisma/schema.prisma` — full v1 model (was datasource+generator only).
- `prisma/migrations/20260629020818_init_data_model/` — initial migration (applied to Supabase).
- `prisma/seed.ts` — idempotent seed (NEW).
- `package.json` — `prisma.seed` config; deps `bcryptjs`, devDeps `tsx`, `@types/bcryptjs`.
- `src/domain/priority.ts` + `priority.test.ts` — Priority mirror + helpers (NEW, TDD).

## 4. State of the world
- **Migrations:** `20260629020818_init_data_model` created and applied. `npx prisma migrate
  status` → "Database schema is up to date". Migrations run on `DIRECT_URL` (5432).
- **Env needed:** `DATABASE_URL` + `DIRECT_URL` already real in `.env`. Section 2 must add an
  Auth.js secret (`AUTH_SECRET` / `NEXTAUTH_SECRET`) to `.env` + `.env.example`.
- **How to run:** `npm install` → `npx prisma generate` → `npm run db:seed` → `npm run dev`.
- **Verified:** `npm run typecheck` clean · `npm test` 9/9 · `npm run build` clean (6 routes) ·
  `npx prisma validate` ok · seed ran twice (idempotent: 8 tasks both times) · no `.env` tracked.
- **Not verified:** no browser smoke for this section — Section 1 added no UI; the board page is
  still the Section 0 placeholder and reads no DB yet (Section 3 wires it).

## 5. Open issues / deferred
- **Auth.js adapter tables not modelled.** `User` carries `passwordHash` for Credentials+JWT,
  which needs no `Account`/`Session`/`VerificationToken` tables. If Section 2 chooses DB
  sessions, add those tables via a new migration. (`next-auth@beta` v5 installed since §0.)
- **Custom field values** store `value Json?` (plus a `people` m2m for PEOPLE fields). Sorting
  / filtering by custom-field value is app-side for now; revisit if a section needs SQL sort.
- **No `Notification` / `SavedView` / search tables yet** — deferred to their owning sections
  (§12 notifications, §9 saved views) which add them via their own migrations.
- Board accent colors and tag colors in the seed are literal hex (fixture data stored in DB
  rows, not stylesheet values) — intentionally outside the DESIGN.md token palette.
- `bcryptjs` chosen for password hashing so seeded users can log in immediately; Section 2
  should use `bcrypt.compare` against `passwordHash` (or swap the algorithm + reseed).

## 6. NEXT SECTION (Section 2): Auth + permissions
**Goal:** working login (Credentials), session with role, a reusable **row-level scoping
helper**, and a minimal admin user-management surface. CEO sees all tasks; a MEMBER sees only
tasks they are assigned to (but any member can assign to anyone).

**Entry point:** create `src/auth.ts` (Auth.js v5 config) + `src/app/api/auth/[...nextauth]/route.ts`.

**First 3 steps:**
1. Add `AUTH_SECRET` to `.env`/`.env.example`. Configure `next-auth@beta` Credentials provider:
   look up `User` by email, `bcrypt.compare(password, passwordHash)`, return `{ id, role, name,
   email, timezone }`; JWT session callback carries `role` + `id` onto `session.user`.
2. Build `src/lib/scope.ts`: a pure-ish helper that, given the session user, returns a Prisma
   `where` fragment for Task queries — `{}` (all) for CEO, `{ assignees: { some: { id } } }`
   for MEMBER. Unit-test the helper in `src/domain` (keep the pure where-builder there;
   server glue in `src/lib`). This is **load-bearing** — every Task read in later sections
   composes this fragment. See `halevora-permissions-audit` skill.
3. Login page under `src/app/(auth)/login/`, `middleware.ts` to gate app routes, sign-out, and
   a CEO-only `/admin/users` to create/rename members + set role. Seeded login: any
   `@halevora.com` user above, password `halevora`.

**Gotchas:**
- Members can ASSIGN to anyone but only SEE their assigned tasks — scoping is on read, not on
  who can be picked as assignee. Don't conflate the two.
- Keep the scoping where-builder pure and tested; a bug here is a data-leak. Run
  `halevora-permissions-audit` before the Section 3 handoff.
- Subtasks are Tasks: decide whether a member sees a subtask of a task they're not assigned to
  (recommend: scope by the subtask's own assignees, consistent with top-level tasks).
- Run `halevora-qa-gate` before writing the Section 3 handoff.
