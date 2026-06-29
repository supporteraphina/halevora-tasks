# Deploying Halevora Tasks (Railway)

Halevora Tasks is a Next.js app with **realtime** (SSE + Postgres `LISTEN`) and a **scheduled
worker**, so it must run as a **persistent Node server** — not serverless. Railway is a good fit:
a single always-on service, plus a cron for the time-based worker. Your database is already
hosted (Supabase), so you only deploy the app and point it at Supabase.

The repo includes `railway.json` (start command + auto-migrate on deploy) and a `postinstall`
that generates the Prisma client, so most of this is just setting environment variables.

## 1. Create the service

1. Push to GitHub (already done: `supporteraphina/halevora-tasks`).
2. In Railway: **New Project → Deploy from GitHub repo →** pick this repo.
3. Railway auto-detects Next.js (Nixpacks). It installs (`npm ci` → `prisma generate` →
   `next build`) and starts with `npm run start`. `railway.json` runs
   `npx prisma migrate deploy` on every deploy, so the database schema stays in sync.

## 2. Environment variables (Service → Variables)

Copy these from your local `.env` (see `.env.example`). **Never commit real values.**

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **pooled** string (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase **session** string (port 5432) — used by migrations + the LISTEN worker |
| `AUTH_SECRET` | strong random — `openssl rand -base64 32` (or the node one-liner in `.env.example`) |
| `AUTH_URL` | the public URL Railway gives you, e.g. `https://halevora-tasks-production.up.railway.app` (or your custom domain) |
| `ANTHROPIC_API_KEY` | enables the task "AI assist"; optional (degrades gracefully if unset) |
| `CRON_SECRET` | random — gates the worker endpoints (see step 4) |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | optional — enables file attachments |

Railway sets `PORT` automatically; `npm run start` (`next start`) binds it. Redeploy after
setting variables.

## 3. First run — create the CEO, skip the demo seed

The seed (`npm run db:seed`) is **demo data** with a known password (`halevora`) — do **not**
run it on a real deployment. Instead:

- Create your first CEO account once. Easiest: from your machine, point `.env` at the production
  DB and run a one-off, **or** temporarily seed then immediately change every password via the
  **Admin → Users** screen (CEO only). Seeded login if you do seed: `noel@halevora.com` /
  `halevora` — change it right away.

## 4. Schedule the workers (time-based recurrence + automation)

Status-change recurrences and automations fire **inline** with no setup. The **time-based**
ones (a recurrence/automation set to run on a schedule) need a periodic ping. Two options:

- **External cron (simplest):** at [cron-job.org](https://cron-job.org) (or any cron), every
  5 minutes send `POST` to both, with header `Authorization: Bearer <CRON_SECRET>`:
  - `https://<your-domain>/api/recurrence/run`
  - `https://<your-domain>/api/automation/run`
- **Railway cron service:** add a second service from the same repo, set its **Cron Schedule**
  to `*/5 * * * *` and its start command to
  `npm run recur:worker && npm run automation:worker` (these read `DIRECT_URL` and run one pass).

Without this, scheduled recurrences/automations simply won't fire; everything else works.

## 5. Important for this app

- **Single instance.** Realtime presence + the SSE fan-out are in-memory per process. For a team
  this size, run **one** web instance — do not autoscale to many replicas (they wouldn't share
  presence and would each open a LISTEN).
- **HTTPS is required** in production (auth cookies + SSE). Railway provides it automatically.
- **`AUTH_URL` must match the real URL.** Auth.js v5 also needs a trusted host; the app sets
  `trustHost: true`, but `AUTH_URL` makes login/callback URLs correct behind Railway's proxy.
- **Custom domain:** add it in Railway → Settings → Networking, then update `AUTH_URL` to match.

## 6. Updating

Push to `main`. Railway rebuilds, runs `prisma migrate deploy`, and restarts. New Prisma
migrations (added under `prisma/migrations/`) apply automatically on deploy.

---

### Self-hosting on your own VPS instead

Same app, full control: `npm ci && npx prisma migrate deploy && npm run build && npm start`,
kept alive with **systemd** or **pm2**, behind **Caddy** (automatic HTTPS). Set the same
environment variables and the same worker cron. Ask and I'll add a `Dockerfile` + Caddy config.
