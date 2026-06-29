# Halevora Tasks — ClickUp Teardown & Gap Analysis

Confidence legend:
- **[V]** Verified 3-0 by adversarial vote, primary ClickUp API source.
- **[P]** Sourced to ClickUp primary docs/API but vote incomplete (session limit). High confidence.
- **[K]** Domain knowledge / ClickUp behavior, not formally re-verified this run.

## 1. Hierarchy & data model
- **[V]** Workspace (Team) > Spaces > Folders > Lists > Tasks. Folders optional. Lists hold tasks. (developer.clickup.com)
- **[P]** Tasks belong to a **List**. A Kanban "Board" is a *view* of a List; columns = the List's status workflow stages. Cards are tasks.
- **[K]** "Boards as columns" in the user's brief: their columns (Innovations, Client success…) are actually ClickUp **Lists** (or a grouping field), not statuses. For Halevora we model these as first-class **Boards** = our List equivalent; status is a per-task attribute shown as a badge.
- **[P]** Sharing/permissions operate at task / List / Folder granularity (`GET /team/{id}/shared`).

## 2. Status system
- **[P]** Custom statuses: create/rename/color/reorder, grouped into **Not Started / Active / Done / Closed**.
- **[K]** "Overdue" is NOT a status — it's derived: any task with a due date in the past that isn't in a Done/Closed group renders as overdue. Confirms our derived-overdue design.
- **[P]** Status automations exist (see §9).

## 3. Recurring tasks (most error-prone area)
- **[P]** Three status-based trigger modes: **When closed**, **When done**, **On schedule** (date arrives regardless of status).
- **[P]** With status-trigger modes, closing/marking done *before* the due date spawns the next instance immediately.
- **[P]** **On schedule** spawns the next instance when the date arrives, no user action needed.
- **[P/!] IMPORTANT NUANCE:** ClickUp's *new* recurring system auto-sets the recurred instance to a **"New"** status. The *legacy* system let you pick the status. The user's brief says the new task should reset to **To Do** — that's the legacy/configurable behavior. → **Decision: make "status on recur" configurable (default To Do).**
- **[K]** Recurrence frequencies: Daily, Weekly (pick weekdays), Monthly (day-of-month or nth-weekday), Yearly, Every X days/weeks/months, Custom. Card shows a recurring icon.

## 4. Task anatomy
- **[V]** Create-task body: `assignees` (int[]), `group_assignees` (string[]), `priority` (int|null), `status` (string), `due_date`/`start_date` (epoch ms) + `due_date_time`/`start_date_time` booleans (date vs datetime), `time_estimate` (ms), `tags` (string[]), `parent` (string|null → subtask).
- **[P]** **Multiple assignees** + **group assignees**. **Followers/Watchers** = visibility-only, distinct from assignees.
- **[P]** Priority = fixed enum: 1 Urgent, 2 High, 3 Normal, 4 Low (+ none).
- **[P]** Subtasks = `parent` reference (full tasks). **Dependencies** = separate mechanism (`links_to`, blocking/waiting-on).
- **[P]** Task detail collapsible sections: Custom Fields, Subtasks, Related (relationships/dependencies + Docs), Checklists, Assigned comments, Attachments.
- **[K]** Checklists = lightweight ordered to-do items inside a task (not tasks). Distinct from subtasks.
- **[K]** Rich-text description; attachments via upload.

## 5. Custom fields (full type set)
- **[V]** API types: `url, short_text, text, email, phone, number, checkbox, drop_down, labels, currency` (needs currency_type), `date` (optional time), `tasks` (relationship), `users` (people), `emoji` (rating; code_point + count), `automatic_progress, manual_progress, location`.
- **[P]** UI adds **Formula**, **Rollup**, **Attachment**, **AI fields**. ~16+ types.
- **[P]** Each field: `id, name, type, type_config, date_created, hide_from_guests`.

## 6. Views, sort, group, filter
- **[K]** Views: **Board** (Kanban), **List**, **Calendar**, plus Table/Gantt/Timeline/Workload/Activity/Map/Mind Map/Doc/Form/Chat/Embed (out of scope for v1).
- **[K]** Board view: drag cards between columns; group-by selectable (status default, but also assignee/priority/custom field). Column = group value. Collapse columns, WIP limits.
- **[K]** Sort: multi-level (the screenshot showed "3 Sorts") by status, name, assignee, priority, due/start, created/updated/closed, time tracked.
- **[K]** Filter: AND/OR groups on any field; "me mode"; show/hide closed; saved per view.
- **[P]** Calendar shows tasks by **due date** (deadline), not time-blocked work time.

## 7. Chat, comments, activity
- **[K]** Per-task **comments** (threaded, @mentions, assign a comment to someone, reactions, attachments, resolve).
- **[K]** **Activity feed** = auto-logged audit of field changes ("X changed status…", "created task"). ClickBot posts automation notices here.
- **[K]** ClickUp has a **Chat view** = channel-style chat attached to a List/Space — matches the user's "per-board chat" ask.

## 8. Permissions / roles — KEY FINDING
- **[P]** Roles: **Owner** (all perms, custom roles), **Admin** (member + workspace mgmt), **Member** (full edit on all *public* items by default), **Guest** (limited, share-scoped).
- **[P/!] CRITICAL:** ClickUp Members do **NOT** see only their assigned tasks by default — they see everything public. The user's "member sees only assigned" model is **NOT** ClickUp's default; it requires private-by-default scoping or share-based access. → **Decision: Halevora builds custom row-level scoping (assignee-based visibility), not ClickUp's role model.**

## 9. Automations (ClickBot)
- **[P]** Composition: **Trigger** + optional **Conditions** + **Action(s)**, scoped to a Space/Folder/List, applies to tasks/subtasks/both.
- **[P]** Trigger catalog: status changes (scopable from→to, by group), assignee added/removed, comment added, custom field changes, priority changes, start/due date arrives or changes, tag added/removed, task created/moved, time tracked, subtasks/checklists resolved, task type changed, task unblocked.
- **[P]** "Status changes" trigger underpins the recurrence + the user's "ROAS check → call Hunter if low" style flows.
- **[P]** Plan quotas exist (Free 100/mo … Business 10k) — irrelevant for self-host.

## 10. GAP ANALYSIS — what the brief likely missed
Must-have for a credible v1 (★), nice-to-have (○):
- ★ **Notifications + inbox** — in-app + email on assign, mention, comment, due-soon, status change. Without it the app is dead on arrival.
- ★ **@mentions** in descriptions/comments/chat (drives notifications).
- ★ **Global search** across tasks (title, description, assignee, board).
- ★ **Drag-drop reorder** within a column + drag between columns (you implied it; make it explicit + persisted `position`).
- ★ **Activity log / audit history** per task (who changed what, when) — also your compliance friend.
- ★ **File uploads / attachments** (Supabase Storage).
- ★ **Archive vs delete** — Reviewed≈archive; need soft-delete + restore, not hard delete.
- ★ **Time zones** — store UTC, render per-user TZ; critical for due/overdue correctness across a remote team.
- ★ **Real-time presence/collaboration** — you chose SSE; cover live card moves, comment arrival, "who's viewing."
- ★ **Permissions enforcement server-side** for the CEO/member split (per finding §8).
- ○ **Task relationships/dependencies** (blocking/waiting-on) + **checklists** (separate from subtasks).
- ○ **Bulk edit / multi-select** (status, assignee, due, delete on many tasks).
- ○ **Templates** — task templates + board templates (recurring project shapes).
- ○ **Saved filtered views** per user (My Tasks, Today already implied).
- ○ **Keyboard shortcuts** + command palette (power-user speed).
- ○ **WIP limits** per column (advisory cap, ClickApp-style).
- ○ **Watchers/followers** (visibility without assignment).
- ○ **Priority field** (Urgent/High/Normal/Low) — in ClickUp, absent from your brief.
- ○ **Time tracking / estimates** (start/stop timer, rollups) — you have the field, decide if you build the timer.
- ○ **Mobile/responsive + offline** — your last screenshot was a phone layout; PWA + optimistic offline later.
- ○ **Custom fields engine** (the 16 types) — you listed a few; decide depth for v1.
- ○ **Automations builder** (trigger/condition/action) — recurrence is the first automation; a general builder is a later epic.

## Sources (primary)
- developer.clickup.com/reference (API: tasks, custom fields, hierarchy) — **primary**
- developer.clickup.com/docs/general-v2-v3-api — **primary**
- help.clickup.com … Use-recurring-tasks, Use-Automation-Triggers, Owner-admin-member-roles, WIP-Limits, Custom-Fields-subtasks-relationships — **primary**
- clickup.com/blog/ultimate-guide-to-clickup-terms-features — **primary**
