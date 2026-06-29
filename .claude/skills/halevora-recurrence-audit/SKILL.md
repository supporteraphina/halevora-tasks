---
name: halevora-recurrence-audit
description: Verifies the Halevora Tasks recurring-task engine. Checks daily/weekly/monthly/yearly/custom recurrence, both triggers (on status-change and on schedule), status-on-recur reset (configurable, default TODO), the old instance leaving the active board, UTC storage with per-user timezone rendering, derived (never stored) overdue, correct field duplication, and recurrence events appearing in the activity log. Use when building or changing recurrence, the scheduled worker, or task duplication.
user-invocable: true
---

# Halevora Recurrence Audit

Verifies the recurring-task engine behaves to spec. Recurrence spawns a **fresh copy** and
the **old instance leaves the active board**; the new instance's status is **configurable,
default `TODO`** (legacy-ClickUp behavior — do not force a "New" status).

## Checklist

1. **Frequencies** — daily, weekly, monthly, yearly, and custom intervals each compute the
   next occurrence correctly, including month-end and leap-year edge cases (e.g. Jan 31 +
   1 month, Feb 29).
2. **Trigger: on status-change** — completing/closing a recurring task spawns the next
   instance inline at that moment.
3. **Trigger: on schedule** — the scheduled worker spawns due instances independently of
   status. Confirm the worker's clock basis is UTC and it does not double-spawn (idempotent
   per occurrence) or skip occurrences if it misses a tick.
4. **Status on recur** — the new instance resets to the configured status; when unset the
   default is `TODO`. Verify the config is read per-task, not hard-coded.
5. **Old instance** — leaves the active board as intended (e.g. archived / moved to
   Reviewed/Closed per spec) and is never hard-deleted.
6. **Field duplication** — the spawned copy carries the correct fields (title, board,
   assignees, description, tags, custom fields, recurrence rule) and resets the right ones
   (status, due/start dates advanced to the new occurrence, comments/activity NOT copied).
   Confirm no stale due date carries over.
7. **Timezone** — dates stored in **UTC**, rendered in each user's timezone. A recurrence
   boundary (e.g. "daily at midnight") must respect the configured timezone, not server
   local time.
8. **Overdue is derived** — confirm overdue is computed (past due-date AND not Done/Closed)
   and never written to a status column.
9. **Activity log** — each recurrence event (spawn + old instance leaving) is recorded in
   the per-task activity log / feed.

## Verify

Prefer unit tests on the pure occurrence-calculation logic (keep it in `src/domain`,
testable, no DB), plus an integration check that a status-change and a worker tick each
produce exactly one correct new instance. State which you ran and the results.

## Output

Per-item PASS / FAIL with file:line and the failing case for any FAIL. Verdict:
**RECURRENCE OK** or **RECURRENCE FAIL** with the broken behaviors enumerated.
