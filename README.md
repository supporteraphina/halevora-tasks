# Halevora Tasks

A self-hosted, single-tenant clone of ClickUp's Board (Kanban) section, built for the Halevora
team. The team owns its task tool: their data, their rules, no per-seat fees. Boards are columns,
tasks are cards, and each person sees only their own work.

Built on Next.js (App Router) + TypeScript, Prisma over Supabase Postgres, Auth.js credentials,
and a dark OKLCH design system. Realtime runs on Server-Sent Events plus Postgres `LISTEN/NOTIFY`.

## What you get (v1)

- **Boards as columns.** Create a board for a team, a client, or a workstream. Each board has its
  own chat and its own automations.
- **Scoped permissions.** The CEO sees every task on every board. A team member sees only the tasks
  assigned to them, enforced server-side on every read and write. Anyone can assign work to anyone.
- **Tasks and statuses.** To Do, In Progress, Done, and Reviewed, plus a derived Overdue state
  (past due and not closed, never stored). Reviewed tasks leave the board into their own view.
- **Task detail.** Rich Tiptap description with an optional Claude writing assist, subtasks,
  checklists, time estimate, tags, priority, start and due dates with a ClickUp-style picker, an
  activity log, and comments.
- **Custom fields.** Text, number, checkbox, date, dropdown, labels, a star rating, a people field,
  and a manual-progress slider.
- **Dependencies.** Link blocking and waiting-on tasks. Cycles are rejected. A task cannot close
  while a blocker is still open.
- **Recurring tasks.** Daily, weekly, monthly, yearly, or custom. Recurrence triggers on a status
  change or on a schedule. A new instance spawns fresh and the old copy leaves the board.
- **Automation builder.** Build your own trigger, condition, and action rules. A scheduled worker
  runs time-based rules.
- **Views and calendar.** My Tasks, All Tasks (CEO), Today, Reviewed, and a Calendar with month,
  week, and day modes plus drag-to-reschedule. Add Tasks Quickly is a fast-entry view. Multi-sort,
  quick filters, and saved views round it out.
- **Templates and bulk edit.** Save a task as a reusable template, then create from it. Select many
  cards and edit them in one pass.
- **Realtime and chat.** Per-board chat, a live board, and presence, all over one SSE stream.
- **Notifications, mentions, and search.** An inbox with a live bell, @mentions in comments and
  chat, and a scoped global search you reach with Ctrl/Cmd-K.

Nothing is ever hard-deleted. Archive and restore keep work recoverable.

## Run it

```bash
npm install
npx prisma generate
npm run db:seed
npm run dev
```

Open http://localhost:3000.

You need a `.env` file (gitignored). Copy `.env.example` and fill in:

- `DATABASE_URL` — pooled Supabase connection (also used for `NOTIFY`).
- `DIRECT_URL` — session connection on port 5432 (the `LISTEN` worker needs this; the pooler
  cannot `LISTEN`).
- `AUTH_SECRET` — any random secret for Auth.js.
- `ANTHROPIC_API_KEY` — enables the Claude writing assist in the description editor.
- `SUPABASE_SERVICE_ROLE_KEY` (optional) — enables file attachments via Supabase Storage.

## Seeded logins

Every seeded account uses the password `halevora`.

| Email | Role |
| --- | --- |
| `noel@halevora.com` | CEO (sees all) |
| `member1@halevora.com` | Member |
| `member2@halevora.com` | Member |
| `member3@halevora.com` | Member |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run typecheck` | Type-check both the app and the domain |
| `npm test` | Run the domain unit tests (vitest) |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed the database |
| `npm run recur:worker` | Run the recurring-task worker |
| `npm run automation:worker` | Run the automation worker |

## Architecture notes

- Pure, framework-free logic lives in `src/domain/` and is unit-tested there. Server glue resolves
  "who is asking" and composes the scoping fragment into every query.
- All color flows through `src/styles/tokens.css`. The theme is dark; the variable indirection
  leaves room for a light theme later.
- Row-level visibility is the load-bearing security model. See `docs/handoffs/` for the full build
  history and `PRODUCT.md` / `DESIGN.md` for the product and design intent.
