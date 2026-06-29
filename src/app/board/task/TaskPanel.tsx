"use client";

import {
  useState,
  useRef,
  useEffect,
  useActionState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  setStatusAction,
  setPriorityAction,
  toggleAssigneeAction,
  setDateAction,
  setTimeEstimateAction,
  toggleTagAction,
  createTagAction,
  setDescriptionAction,
  createSubtaskAction,
  toggleSubtaskAction,
  addChecklistAction,
  deleteChecklistAction,
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
  renameTaskAction,
  type DetailActionState,
} from "./actions";
import { aiAssistDescription } from "./ai";
import { STATUS_GROUPS, badgeFor, type BadgeKey } from "@/domain/statusGroups";
import { PRIORITIES } from "@/domain/priority";
import { QUICK_CHOICES } from "@/domain/dates";
import { formatTimeEstimate } from "@/domain/taskDetail";
import { formatInZone, dateInputValue } from "@/domain/dates";
import { DescriptionEditor } from "./DescriptionEditor";
import {
  CustomFieldsSection,
  AttachmentsSection,
  ActivitySection,
  DependenciesSection,
  RecurrenceSection,
} from "./TaskPanelExtras";
import { saveAsTemplateAction } from "@/app/board/templates/actions";
import { TaskErrorBoundary, useReportActionError } from "./actionError";
import type { TaskDetail, PickerData } from "./data";
import type { Status, Priority } from "@prisma/client";
import styles from "./panel.module.css";

const BADGE_VARS: Record<BadgeKey, string> = {
  TODO: "todo",
  IN_PROGRESS: "progress",
  DONE: "done",
  REVIEWED: "reviewed",
  OVERDUE: "overdue",
};

const STATUS_TEXT: Record<Status, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

const PRIORITY_META: Record<Priority, { label: string; varName: string }> = {
  URGENT: { label: "Urgent", varName: "--prio-urgent" },
  HIGH: { label: "High", varName: "--prio-high" },
  NORMAL: { label: "Normal", varName: "--prio-normal" },
  LOW: { label: "Low", varName: "--prio-low" },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Run a server action with a FormData payload, surface any error, then refresh the route. */
function useAction() {
  const router = useRouter();
  const reportError = useReportActionError();
  const [pending, startTransition] = useTransition();
  const run = (
    action: (s: DetailActionState, fd: FormData) => Promise<DetailActionState>,
    fields: Record<string, string>,
  ) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(async () => {
      const result = await action({}, fd);
      if (result?.error) reportError(result.error);
      router.refresh();
    });
  };
  return { run, pending };
}

/** A small popover that closes on outside-click / Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export default function TaskPanel({
  task,
  picker,
  timezone,
  currentUserId,
  isCeo,
  aiEnabled,
  onClose,
}: {
  task: TaskDetail;
  picker: PickerData;
  timezone: string;
  currentUserId: string;
  isCeo: boolean;
  aiEnabled: boolean;
  onClose: () => void;
}) {
  const badge = badgeFor(task, new Date());
  const panelRef = useRef<HTMLElement>(null);

  // Esc closes the whole panel.
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // Focus management: move focus into the panel on open and restore it to the previously
  // focused element (the card that opened it) on close — so a keyboard user isn't dropped at
  // the top of the document.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Contain Tab focus within the panel while it's open (a lightweight focus trap).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Task detail">
      <div className={`${styles.backdrop} hv-scrim`} onClick={onClose} aria-hidden="true" />
      <aside className={`${styles.panel} hv-drawer`} ref={panelRef} tabIndex={-1}>
        <TaskErrorBoundary className={styles.actionErrorToast}>
        <header className={styles.panelHeader}>
          <span className={styles.breadcrumb}>{task.boardName}</span>
          <div className={styles.headerActions}>
            <SaveTemplateControl task={task} />
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className={styles.scroll}>
          <TitleEditor task={task} />

          <StatusControl task={task} badgeKey={badge.key} />

          <section className={styles.fields}>
            <AssigneesField task={task} picker={picker} currentUserId={currentUserId} />
            <DatesField task={task} timezone={timezone} />
            <PriorityField task={task} />
            <TagsField task={task} picker={picker} />
            <TimeEstimateField task={task} />
          </section>

          <DescriptionField task={task} aiEnabled={aiEnabled} />

          <SubtasksSection task={task} />

          <ChecklistsSection task={task} />

          <CustomFieldsSection task={task} picker={picker} isCeo={isCeo} />

          <DependenciesSection task={task} />

          <RecurrenceSection task={task} timezone={timezone} />

          <AttachmentsSection task={task} />

          <ActivitySection
            task={task}
            timezone={timezone}
            currentUserId={currentUserId}
          />
        </div>
        </TaskErrorBoundary>
      </aside>
    </div>
  );
}

// --- Save as template -------------------------------------------------------

/**
 * "Save as template" — snapshots this task's blueprint into a shared `TaskTemplate`. Any user
 * who can see the task may save it (templates are shared). Opens a small popover for the name.
 */
function SaveTemplateControl({ task }: { task: TaskDetail }) {
  const router = useRouter();
  const { open, setOpen, ref } = usePopover();
  const [name, setName] = useState(task.title);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Name the template first.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("name", trimmed);
    startTransition(async () => {
      const result = await saveAsTemplateAction({}, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1200);
    });
  }

  return (
    <div className={styles.headerMenuWrap} ref={ref}>
      <button
        type="button"
        className={styles.headerBtn}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setName(task.title);
          setError(null);
          setDone(false);
          setOpen((v) => !v);
        }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M2.5 2.5h7l2 2v7h-9z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M4.5 2.5v3h4v-3M4.5 11.5v-3h5v3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        Save as template
      </button>
      {open ? (
        <div className={styles.headerMenu} role="dialog" aria-label="Save as template">
          <p className={styles.headerMenuTitle}>Save this task as a template</p>
          {done ? (
            <p className={styles.headerMenuDone}>Saved. Find it under Templates.</p>
          ) : (
            <>
              <input
                className={styles.headerMenuInput}
                placeholder="Template name"
                value={name}
                autoFocus
                disabled={pending}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                }}
                aria-label="Template name"
              />
              {error ? <p className={styles.headerMenuError}>{error}</p> : null}
              <div className={styles.headerMenuActions}>
                <button
                  type="button"
                  className={styles.smallBtn}
                  disabled={pending}
                  onClick={save}
                >
                  {pending ? "Saving…" : "Save template"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// --- Title ------------------------------------------------------------------

function TitleEditor({ task }: { task: TaskDetail }) {
  const { run, pending } = useAction();
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);

  function commit() {
    const t = value.trim();
    if (t.length === 0 || t === task.title) {
      setValue(task.title);
      return;
    }
    run(renameTaskAction, { taskId: task.id, title: t });
  }

  return (
    <textarea
      className={styles.title}
      value={value}
      rows={1}
      disabled={pending}
      aria-label="Task title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

// --- Status -----------------------------------------------------------------

function StatusControl({ task, badgeKey }: { task: TaskDetail; badgeKey: BadgeKey }) {
  const router = useRouter();
  const { open, setOpen, ref } = usePopover();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tone = BADGE_VARS[badgeKey];

  // Clear a transient error after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // The server enforces the Done-gate; surface its {error} (e.g. "Blocked by N open tasks").
  function choose(status: Status) {
    setOpen(false);
    setError(null);
    const fd = new FormData();
    fd.set("taskId", task.id);
    fd.set("status", status);
    startTransition(async () => {
      const result = await setStatusAction({}, fd);
      if (result?.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className={styles.statusRow}>
      <div className={styles.badgeWrap} ref={ref}>
        <button
          type="button"
          className={styles.statusBadge}
          data-tone={tone}
          disabled={pending}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.badgeDot} data-tone={tone} aria-hidden="true" />
          {badgeKey === "OVERDUE" ? "Overdue" : STATUS_TEXT[task.status]}
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open ? (
          <div className={styles.menu} role="listbox" aria-label="Set status">
            {STATUS_GROUPS.map((group) => (
              <div key={group.label} className={styles.menuGroup}>
                <p className={styles.menuGroupLabel}>{group.label}</p>
                {group.statuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={s === task.status}
                    className={styles.menuOption}
                    onClick={() => choose(s)}
                  >
                    <span className={styles.badgeDot} data-tone={BADGE_VARS[s]} aria-hidden="true" />
                    {STATUS_TEXT[s]}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className={styles.statusError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- Assignees --------------------------------------------------------------

function AssigneesField({
  task,
  picker,
  currentUserId,
}: {
  task: TaskDetail;
  picker: PickerData;
  currentUserId: string;
}) {
  const { run, pending } = useAction();
  const { open, setOpen, ref } = usePopover();
  const assignedIds = new Set(task.assignees.map((a) => a.id));

  function toggle(userId: string, isAssigned: boolean) {
    // Warn a MEMBER who is about to remove themselves (loses their own visibility).
    if (isAssigned && userId === currentUserId) {
      const ok = window.confirm(
        "Removing yourself will hide this task from your board. Continue?",
      );
      if (!ok) return;
    }
    run(toggleAssigneeAction, {
      taskId: task.id,
      userId,
      op: isAssigned ? "remove" : "add",
    });
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Assignees</span>
      <div className={styles.fieldValue} ref={ref}>
        <button
          type="button"
          className={styles.chipBtn}
          disabled={pending}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {task.assignees.length === 0 ? (
            <span className={styles.placeholder}>+ Assign</span>
          ) : (
            <span className={styles.avatars}>
              {task.assignees.map((a) => (
                <span key={a.id} className={styles.avatar} title={a.name}>
                  {initials(a.name)}
                </span>
              ))}
            </span>
          )}
        </button>
        {open ? (
          <div className={styles.menu} role="menu">
            {picker.users.map((u) => {
              const isAssigned = assignedIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isAssigned}
                  className={styles.menuOption}
                  onClick={() => toggle(u.id, isAssigned)}
                >
                  <span className={styles.avatar}>{initials(u.name)}</span>
                  <span className={styles.menuOptionText}>
                    {u.name}
                    {u.id === currentUserId ? " (you)" : ""}
                  </span>
                  {isAssigned ? <Check /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Dates ------------------------------------------------------------------

function DatesField({ task, timezone }: { task: TaskDetail; timezone: string }) {
  return (
    <>
      <DateField
        task={task}
        timezone={timezone}
        field="start"
        label="Start date"
        value={task.startAt}
      />
      <DateField
        task={task}
        timezone={timezone}
        field="due"
        label="Due date"
        value={task.dueAt}
        overdue={badgeFor(task, new Date()).key === "OVERDUE" && task.dueAt != null}
      />
    </>
  );
}

function DateField({
  task,
  timezone,
  field,
  label,
  value,
  overdue,
}: {
  task: TaskDetail;
  timezone: string;
  field: "start" | "due";
  label: string;
  value: Date | null;
  overdue?: boolean;
}) {
  const { run, pending } = useAction();
  const { open, setOpen, ref } = usePopover();

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.fieldValue} ref={ref}>
        <button
          type="button"
          className={styles.chipBtn}
          data-overdue={overdue || undefined}
          disabled={pending}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {value ? (
            <span className={styles.dateText}>{formatInZone(value, timezone)}</span>
          ) : (
            <span className={styles.placeholder}>+ Set date</span>
          )}
        </button>
        {open ? (
          <div className={styles.menu}>
            <div className={styles.quickChoices}>
              {QUICK_CHOICES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={styles.quickChoice}
                  onClick={() => {
                    setOpen(false);
                    run(setDateAction, {
                      taskId: task.id,
                      field,
                      mode: "quick",
                      quick: c.key,
                    });
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className={styles.dateInputRow}>
              <input
                type="date"
                className={styles.dateInput}
                defaultValue={value ? dateInputValue(value, timezone) : ""}
                aria-label={`${label} exact date`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setOpen(false);
                  run(setDateAction, {
                    taskId: task.id,
                    field,
                    mode: "date",
                    date: v,
                  });
                }}
              />
            </div>
            {value ? (
              <button
                type="button"
                className={styles.clearDate}
                onClick={() => {
                  setOpen(false);
                  run(setDateAction, { taskId: task.id, field, mode: "clear" });
                }}
              >
                Clear date
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Priority ---------------------------------------------------------------

function PriorityField({ task }: { task: TaskDetail }) {
  const { run, pending } = useAction();
  const { open, setOpen, ref } = usePopover();
  const meta = PRIORITY_META[task.priority];

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Priority</span>
      <div className={styles.fieldValue} ref={ref}>
        <button
          type="button"
          className={styles.chipBtn}
          disabled={pending}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Flag varName={meta.varName} />
          <span>{meta.label}</span>
        </button>
        {open ? (
          <div className={styles.menu} role="listbox" aria-label="Set priority">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={p === task.priority}
                className={styles.menuOption}
                onClick={() => {
                  setOpen(false);
                  run(setPriorityAction, { taskId: task.id, priority: p });
                }}
              >
                <Flag varName={PRIORITY_META[p].varName} />
                <span className={styles.menuOptionText}>{PRIORITY_META[p].label}</span>
                {p === task.priority ? <Check /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Tags -------------------------------------------------------------------

function TagsField({ task, picker }: { task: TaskDetail; picker: PickerData }) {
  const { run, pending } = useAction();
  const { open, setOpen, ref } = usePopover();
  const [newTag, setNewTag] = useState("");
  const assignedIds = new Set(task.tags.map((t) => t.id));

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Tags</span>
      <div className={styles.fieldValue} ref={ref}>
        <button
          type="button"
          className={styles.chipBtn}
          disabled={pending}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {task.tags.length === 0 ? (
            <span className={styles.placeholder}>+ Add tags</span>
          ) : (
            <span className={styles.tagList}>
              {task.tags.map((t) => (
                <span
                  key={t.id}
                  className={styles.tag}
                  style={t.color ? { borderColor: t.color, color: t.color } : undefined}
                >
                  {t.name}
                </span>
              ))}
            </span>
          )}
        </button>
        {open ? (
          <div className={styles.menu} role="menu">
            {picker.tags.map((t) => {
              const isOn = assignedIds.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isOn}
                  className={styles.menuOption}
                  onClick={() =>
                    run(toggleTagAction, {
                      taskId: task.id,
                      tagId: t.id,
                      op: isOn ? "remove" : "add",
                    })
                  }
                >
                  <span
                    className={styles.tagDot}
                    style={{ background: t.color ?? "var(--ink-subtle)" }}
                    aria-hidden="true"
                  />
                  <span className={styles.menuOptionText}>{t.name}</span>
                  {isOn ? <Check /> : null}
                </button>
              );
            })}
            <form
              className={styles.tagCreate}
              onSubmit={(e) => {
                e.preventDefault();
                const name = newTag.trim();
                if (!name) return;
                setNewTag("");
                run(createTagAction, { taskId: task.id, name });
              }}
            >
              <input
                className={styles.tagInput}
                placeholder="New tag…"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                aria-label="New tag name"
              />
              <button type="submit" className={styles.smallBtn} disabled={pending}>
                Add
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Time estimate ----------------------------------------------------------

function TimeEstimateField({ task }: { task: TaskDetail }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    task.timeEstimate != null ? String(task.timeEstimate) : "",
  );
  useEffect(() => {
    setValue(task.timeEstimate != null ? String(task.timeEstimate) : "");
  }, [task.timeEstimate]);

  function commit() {
    setEditing(false);
    run(setTimeEstimateAction, { taskId: task.id, minutes: value });
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Time estimate</span>
      <div className={styles.fieldValue}>
        {editing ? (
          <span className={styles.estimateEdit}>
            <input
              className={styles.estimateInput}
              type="number"
              min={0}
              autoFocus
              value={value}
              disabled={pending}
              aria-label="Time estimate in minutes"
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setValue(task.timeEstimate != null ? String(task.timeEstimate) : "");
                }
              }}
            />
            <span className={styles.estimateUnit}>min</span>
          </span>
        ) : (
          <button
            type="button"
            className={styles.chipBtn}
            onClick={() => setEditing(true)}
          >
            {task.timeEstimate != null ? (
              formatTimeEstimate(task.timeEstimate)
            ) : (
              <span className={styles.placeholder}>+ Estimate</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Description ------------------------------------------------------------

function DescriptionField({
  task,
  aiEnabled,
}: {
  task: TaskDetail;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [aiPending, startAi] = useTransition();
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);

  function save(json: string) {
    startSaving(async () => {
      const fd = new FormData();
      fd.set("taskId", task.id);
      fd.set("description", json);
      await setDescriptionAction({}, fd);
      router.refresh();
    });
  }

  function runAi() {
    setAiMsg(null);
    startAi(async () => {
      const result = await aiAssistDescription(task.id, "");
      if (result.text) {
        setAiText(result.text);
        setAiMsg("Inserted a draft below. Edit and it saves on blur.");
      } else {
        setAiMsg(result.error ?? "AI assist is unavailable.");
      }
    });
  }

  return (
    <section className={styles.descSection}>
      <div className={styles.descHeader}>
        <h3 className={styles.sectionTitle}>Description</h3>
        <button
          type="button"
          className={styles.aiBtn}
          disabled={!aiEnabled || aiPending}
          title={
            aiEnabled
              ? "Draft a description with AI"
              : "Set ANTHROPIC_API_KEY to enable AI assist"
          }
          onClick={runAi}
        >
          <Sparkle />
          {aiPending ? "Drafting…" : "AI assist"}
        </button>
      </div>
      {aiMsg ? (
        <p className={styles.aiMsg} role="status">
          {aiMsg}
        </p>
      ) : null}
      <DescriptionEditor
        initialDoc={task.description}
        insertText={aiText}
        onInserted={() => setAiText(null)}
        onSave={save}
        saving={saving}
      />
    </section>
  );
}

// --- Subtasks ---------------------------------------------------------------

function SubtasksSection({ task }: { task: TaskDetail }) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const done = task.subtasks.filter((s) => s.status === "DONE").length;

  function add() {
    const t = title.trim();
    if (!t) {
      setAdding(false);
      return;
    }
    setTitle("");
    run(createSubtaskAction, { taskId: task.id, title: t });
    inputRef.current?.focus();
  }

  return (
    <section className={styles.listSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>
          Subtasks
          {task.subtasks.length > 0 ? (
            <span className={styles.countPill}>
              {done}/{task.subtasks.length}
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          className={styles.addLink}
          onClick={() => setAdding(true)}
        >
          + Add subtask
        </button>
      </div>

      <ul className={styles.subtaskList}>
        {task.subtasks.map((s) => (
          <li key={s.id} className={styles.subtaskItem}>
            <button
              type="button"
              className={styles.check}
              data-done={s.status === "DONE" || undefined}
              disabled={pending}
              aria-label={s.status === "DONE" ? "Mark not done" : "Mark done"}
              onClick={() => run(toggleSubtaskAction, { subtaskId: s.id })}
            >
              {s.status === "DONE" ? <Check /> : null}
            </button>
            <span
              className={styles.subtaskTitle}
              data-done={s.status === "DONE" || undefined}
            >
              {s.title}
            </span>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className={styles.inlineComposer}>
          <input
            ref={inputRef}
            className={styles.inlineInput}
            placeholder="Subtask name"
            value={title}
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                setAdding(false);
                setTitle("");
              }
            }}
            onBlur={() => {
              if (!title.trim()) setAdding(false);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

// --- Checklists -------------------------------------------------------------

function ChecklistsSection({ task }: { task: TaskDetail }) {
  const { run, pending } = useAction();

  return (
    <section className={styles.listSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Checklists</h3>
        <button
          type="button"
          className={styles.addLink}
          disabled={pending}
          onClick={() => run(addChecklistAction, { taskId: task.id, name: "" })}
        >
          + Add checklist
        </button>
      </div>

      {task.checklists.map((cl) => (
        <ChecklistBlock key={cl.id} task={task} checklist={cl} />
      ))}
    </section>
  );
}

function ChecklistBlock({
  task,
  checklist,
}: {
  task: TaskDetail;
  checklist: TaskDetail["checklists"][number];
}) {
  const { run, pending } = useAction();
  const [content, setContent] = useState("");
  const done = checklist.items.filter((i) => i.done).length;

  function addItem() {
    const c = content.trim();
    if (!c) return;
    setContent("");
    run(addChecklistItemAction, {
      taskId: task.id,
      checklistId: checklist.id,
      content: c,
    });
  }

  return (
    <div className={styles.checklist}>
      <div className={styles.checklistHeader}>
        <span className={styles.checklistName}>
          {checklist.name}
          {checklist.items.length > 0 ? (
            <span className={styles.countPill}>
              {done}/{checklist.items.length}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          disabled={pending}
          aria-label="Delete checklist"
          onClick={() =>
            run(deleteChecklistAction, {
              taskId: task.id,
              checklistId: checklist.id,
            })
          }
        >
          <Trash />
        </button>
      </div>

      <ul className={styles.checkItems}>
        {checklist.items.map((item) => (
          <li key={item.id} className={styles.checkItem}>
            <button
              type="button"
              className={styles.check}
              data-done={item.done || undefined}
              disabled={pending}
              aria-label={item.done ? "Uncheck" : "Check"}
              onClick={() =>
                run(toggleChecklistItemAction, {
                  taskId: task.id,
                  itemId: item.id,
                })
              }
            >
              {item.done ? <Check /> : null}
            </button>
            <span className={styles.checkText} data-done={item.done || undefined}>
              {item.content}
            </span>
            <button
              type="button"
              className={styles.iconBtn}
              disabled={pending}
              aria-label="Delete item"
              onClick={() =>
                run(deleteChecklistItemAction, {
                  taskId: task.id,
                  itemId: item.id,
                })
              }
            >
              <Trash />
            </button>
          </li>
        ))}
      </ul>

      <form
        className={styles.inlineComposer}
        onSubmit={(e) => {
          e.preventDefault();
          addItem();
        }}
      >
        <input
          className={styles.inlineInput}
          placeholder="Add an item"
          value={content}
          disabled={pending}
          onChange={(e) => setContent(e.target.value)}
        />
      </form>
    </div>
  );
}

// --- Tiny inline icons ------------------------------------------------------

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Flag({ varName }: { varName: string }) {
  return (
    <span className={styles.flag} style={{ color: `var(${varName})` }} aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M3 1v10M3 1h6l-1.2 2L9 5H3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Trash() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 3.5h9M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sparkle() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 1.5l1.2 3.3L11.5 6 8.2 7.2 7 10.5 5.8 7.2 2.5 6l3.3-1.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
