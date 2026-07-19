#!/bin/bash
# Halevora session-start orientation hook (minimal variant for public repos).
# Points every new Claude Code session at the estate map so it routes itself to
# the right repo automatically. Pure text output; no network, no installs.
# Canonical/full variant: supporteraphina/model-communication (private),
# .claude/hooks/session-start.sh + docs/session-bootstrap.md.
set -uo pipefail

PROJ="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REPO="$(git -C "$PROJ" remote get-url origin 2>/dev/null | sed -e 's#/*$##' -e 's#.*/##' -e 's#\.git$##')"
[ -n "$REPO" ] || REPO="$(basename "$PROJ")"
BRANCH="$(git -C "$PROJ" symbolic-ref --short HEAD 2>/dev/null)"
if [ -z "$BRANCH" ]; then
  SHA="$(git -C "$PROJ" rev-parse --short HEAD 2>/dev/null)"
  if [ -n "$SHA" ]; then BRANCH="detached@$SHA"; else BRANCH="unknown"; fi
fi

CTX="HALEVORA - SESSION START (auto-loaded). Orient yourself before doing the task; do this automatically, without being told.

CURRENT: repo '${REPO}', branch '${BRANCH}'. This repo is part of a multi-repo estate - it may not be the right home for this task.

ROUTING - decide the task's home YOURSELF. Owner's standing instruction (2026-07-19): sessions route themselves - never ask which repo, never make the owner assign access; adding or creating the right repo for a routed task is pre-approved. Decide, state in ONE line where you are working and why, then do the task.
- Match the task against the estate map PROJECT-MAP.md on the default branch of the private repo supporteraphina/model-communication (add_repo it, then use the map's task->repo matcher table).
- Task matches an EXISTING repo that is not this one -> add_repo it, clone it into its OWN folder (/workspace/<repo>), check out the right branch, work there. Never mix two repos in one folder.
- Task matches THIS repo -> stay; follow this repo's CLAUDE.md/README.
- Task matches NO repo -> it is a NEW project: create a private repo under supporteraphina (kebab-case name), scaffold it, and register it in PROJECT-MAP.md (procedure in the map's section 0.2).
- Before editing, confirm the target repo's default branch and its deploy rules from the map - some repos auto-deploy on push.

Full detail: CLAUDE.md (if present in this repo) and model-communication/PROJECT-MAP.md."

if command -v python3 >/dev/null 2>&1; then
  python3 - "$CTX" <<'PY'
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[1]}}))
PY
else
  printf '%s\n' "$CTX"
fi
