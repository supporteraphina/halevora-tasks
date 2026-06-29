---
name: halevora-permissions-audit
description: Critical security audit for Halevora Tasks row-level visibility. Verifies CEO sees all tasks, MEMBER sees only assigned tasks, and that this is enforced SERVER-SIDE across every read and write path (API routes, server actions, search, calendar, notifications, activity feed, realtime/SSE, chat). UI hiding is not enough. Use after any change to data access, queries, API routes, server actions, or realtime, and before any handoff that touched task data.
user-invocable: true
argument-hint: "[area: api|search|realtime|notifications|all]"
---

# Halevora Permissions Audit

The load-bearing security invariant of Halevora Tasks:

- **CEO sees ALL tasks.**
- **MEMBER sees ONLY tasks assigned to them** (any member may assign to anyone).
- Enforcement is **server-side, row-level**. UI hiding alone is a failure.
- Do **not** copy ClickUp's public-member visibility model.

Hidden-task data must never leak to a MEMBER through any channel. Treat a leak as a release
blocker, not a polish item.

## How to audit

Work from the data layer outward. For each read/write path, ask: "could a MEMBER obtain a
task, field, or notification for a task not assigned to them?"

1. **Find the scoping helper.** There must be one canonical server-side function that
   constrains task queries by the current user's role/id (e.g. a Prisma `where` builder).
   Grep for raw `prisma.task.findMany` / `findFirst` / `update` / `delete` and confirm each
   call site routes through that helper or applies the same scope. A bare unscoped task
   query in a request handler is a finding.
2. **Reads — every surface:**
   - REST/route handlers and server actions that return tasks.
   - Global **search** results.
   - **Calendar** view (tasks by due date).
   - **Notifications / inbox** and **@mentions**.
   - Per-task **activity feed** and per-board **chat** history.
   - **Realtime / SSE**: a live event for a hidden task must not be delivered to a member
     who cannot see it. Audit the publish/subscribe filter, not just the initial fetch.
3. **Writes / mutations:** a MEMBER must not mutate, move, comment on, delete, or restore a
   task they cannot access. Verify authorization on the mutation path itself — never trust
   an id from the client.
4. **Object references:** check that nested includes (assignees, subtasks, attachments,
   comments) cannot surface a hidden parent task indirectly.
5. **IDOR test:** as a MEMBER, request a task id assigned only to someone else via the API
   directly (bypassing the UI). Expect 403/404, never the task body.

## Verify, don't assume

For each invariant, prove it with a concrete check — a reading of the query scope plus, where
the app is runnable, a two-account browser/API test (CEO account vs MEMBER account). Note
exactly what you ran and saw.

## Output

List every read/write path examined with PASS / FAIL / NOT-APPLICABLE. For each FAIL: the
file:line, the leak path, and the minimal fix. End with a verdict: **AUDIT PASS** or
**AUDIT FAIL — N leaks** (enumerated). If any leak exists, the section is not deployable.
