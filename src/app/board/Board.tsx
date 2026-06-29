"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createTaskAction,
  changeStatusAction,
  moveCardAction,
} from "./actions";
import {
  STATUS_GROUPS,
  badgeFor,
  type BadgeKey,
} from "@/domain/statusGroups";
import type { Status, Priority } from "@prisma/client";
import type { BoardColumn, BoardCard } from "./data";
import styles from "./board.module.css";

/** Priority dot color + label, keyed to the design tokens. */
const PRIORITY_META: Record<Priority, { label: string; varName: string }> = {
  URGENT: { label: "Urgent", varName: "--prio-urgent" },
  HIGH: { label: "High", varName: "--prio-high" },
  NORMAL: { label: "Normal", varName: "--prio-normal" },
  LOW: { label: "Low", varName: "--prio-low" },
};

/** Maps a badge key to its status-color CSS variable pair. */
const BADGE_VARS: Record<BadgeKey, string> = {
  TODO: "todo",
  IN_PROGRESS: "progress",
  DONE: "done",
  REVIEWED: "reviewed",
  OVERDUE: "overdue",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDue(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface DragState {
  taskId: string;
  fromBoardId: string;
}

export default function Board({ columns }: { columns: BoardColumn[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drag, setDrag] = useState<DragState | null>(null);
  // Index within a column where a drop would land, for the insertion indicator.
  const [dropTarget, setDropTarget] = useState<{
    boardId: string;
    index: number;
  } | null>(null);

  const now = new Date();

  function runMove(taskId: string, toBoardId: string, index: number) {
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("toBoardId", toBoardId);
    fd.set("index", String(index));
    startTransition(async () => {
      await moveCardAction({}, fd);
      router.refresh();
    });
  }

  function onDrop(boardId: string, index: number) {
    if (!drag) return;
    runMove(drag.taskId, boardId, index);
    setDrag(null);
    setDropTarget(null);
  }

  return (
    <div className={styles.boardScroll} data-pending={pending || undefined}>
      <div className={styles.columns}>
        {columns.map((col) => (
          <Column
            key={col.id}
            column={col}
            now={now}
            drag={drag}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDragStart={(taskId) =>
              setDrag({ taskId, fromBoardId: col.id })
            }
            onDragEnd={() => {
              setDrag(null);
              setDropTarget(null);
            }}
            onDrop={onDrop}
          />
        ))}
        {columns.length === 0 ? (
          <p className={styles.emptyBoard}>
            No boards in this project yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Column({
  column,
  now,
  drag,
  dropTarget,
  setDropTarget,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  column: BoardColumn;
  now: Date;
  drag: DragState | null;
  dropTarget: { boardId: string; index: number } | null;
  setDropTarget: (t: { boardId: string; index: number } | null) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onDrop: (boardId: string, index: number) => void;
}) {
  const dotColor = column.color ?? "var(--ink-subtle)";

  // Compute the insertion index from the pointer position over the card list.
  function indexFromEvent(
    e: React.DragEvent,
    listEl: HTMLElement | null,
  ): number {
    if (!listEl) return column.cards.length;
    const cards = Array.from(
      listEl.querySelectorAll<HTMLElement>("[data-card]"),
    );
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  }

  const listRef = useRef<HTMLDivElement>(null);
  const showIndicatorAt =
    dropTarget && dropTarget.boardId === column.id ? dropTarget.index : -1;

  return (
    <section
      className={styles.column}
      aria-label={`${column.name} board`}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        setDropTarget({
          boardId: column.id,
          index: indexFromEvent(e, listRef.current),
        });
      }}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        const idx = indexFromEvent(e, listRef.current);
        onDrop(column.id, idx);
      }}
    >
      <header className={styles.colHeader}>
        <span
          className={styles.colDot}
          style={{ background: dotColor }}
          aria-hidden="true"
        />
        <h2 className={styles.colName}>{column.name}</h2>
        <span className={styles.colCount}>{column.cards.length}</span>
      </header>

      <div className={styles.cardList} ref={listRef}>
        {column.cards.map((card, i) => (
          <div key={card.id} data-card>
            {showIndicatorAt === i ? (
              <div className={styles.dropLine} aria-hidden="true" />
            ) : null}
            <Card
              card={card}
              now={now}
              dragging={drag?.taskId === card.id}
              onDragStart={() => onDragStart(card.id)}
              onDragEnd={onDragEnd}
            />
          </div>
        ))}
        {showIndicatorAt === column.cards.length ? (
          <div className={styles.dropLine} aria-hidden="true" />
        ) : null}
      </div>

      <AddTask boardId={column.id} />
    </section>
  );
}

function Card({
  card,
  now,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  now: Date;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const router = useRouter();
  const badge = badgeFor(card, now);
  const prio = PRIORITY_META[card.priority];

  // Open the detail panel. Skip if the click landed on an interactive control
  // (the status badge button / its menu), so those keep their own behavior.
  function openDetail(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button,a,[role='listbox']")) return;
    router.push(`/board/task/${card.id}`);
  }

  return (
    <article
      className={styles.card}
      data-dragging={dragging || undefined}
      draggable
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/board/task/${card.id}`);
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <p className={styles.cardTitle}>{card.title}</p>

      <div className={styles.cardMeta}>
        <StatusBadge taskId={card.id} badgeKey={badge.key} label={badge.label} />

        {card.priority !== "NORMAL" ? (
          <span
            className={styles.prio}
            title={`${prio.label} priority`}
            aria-label={`${prio.label} priority`}
          >
            <span
              className={styles.prioFlag}
              style={{ color: `var(${prio.varName})` }}
              aria-hidden="true"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 1v10M3 1h6l-1.2 2L9 5H3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </span>
        ) : null}

        {card.assignees.length > 0 ? (
          <span className={styles.avatars}>
            {card.assignees.slice(0, 3).map((a) => (
              <span
                key={a.id}
                className={styles.avatar}
                title={a.name}
                aria-label={a.name}
              >
                {initials(a.name)}
              </span>
            ))}
            {card.assignees.length > 3 ? (
              <span className={styles.avatarMore}>
                +{card.assignees.length - 3}
              </span>
            ) : null}
          </span>
        ) : null}

        {card.dueAt ? (
          <span
            className={styles.due}
            data-overdue={badge.key === "OVERDUE" || undefined}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="1.5"
                y="2.5"
                width="11"
                height="10"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M1.5 5.5h11M4.5 1v2M9.5 1v2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            {formatDue(card.dueAt)}
          </span>
        ) : null}
      </div>

      {card.subtaskCount > 0 ? (
        <div className={styles.subtasks}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 3.5h6M2 7h8M2 10.5h5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          {card.subtaskCount} subtask{card.subtaskCount === 1 ? "" : "s"}
        </div>
      ) : null}
    </article>
  );
}

function StatusBadge({
  taskId,
  badgeKey,
  label,
}: {
  taskId: string;
  badgeKey: BadgeKey;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const tone = BADGE_VARS[badgeKey];

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

  function choose(status: Status) {
    setOpen(false);
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("status", status);
    startTransition(async () => {
      await changeStatusAction({}, fd);
      router.refresh();
    });
  }

  return (
    <div className={styles.badgeWrap} ref={ref}>
      <button
        type="button"
        className={styles.badge}
        data-tone={tone}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
        // Prevent the parent card's drag from hijacking a click on the badge.
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span className={styles.badgeDot} data-tone={tone} aria-hidden="true" />
        {label}
      </button>

      {open ? (
        <div className={styles.statusMenu} role="listbox" aria-label="Set status">
          {STATUS_GROUPS.map((group) => (
            <div key={group.label} className={styles.statusGroup}>
              <p className={styles.statusGroupLabel}>{group.label}</p>
              {group.statuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={s === badgeKey}
                  className={styles.statusOption}
                  onClick={() => choose(s)}
                >
                  <span
                    className={styles.badgeDot}
                    data-tone={BADGE_VARS[s]}
                    aria-hidden="true"
                  />
                  <StatusOptionLabel status={s} />
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusOptionLabel({ status }: { status: Status }) {
  const map: Record<Status, string> = {
    TODO: "To Do",
    IN_PROGRESS: "In Progress",
    DONE: "Done",
    REVIEWED: "Reviewed",
  };
  return <span>{map[status]}</span>;
}

function AddTask({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit() {
    const value = title.trim();
    if (value.length === 0) {
      setOpen(false);
      return;
    }
    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("title", value);
    startTransition(async () => {
      await createTaskAction({}, fd);
      setTitle("");
      router.refresh();
      // Keep the composer open for fast multi-entry.
      inputRef.current?.focus();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.addTask}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">+</span> Add Task
      </button>
    );
  }

  return (
    <div className={styles.composer}>
      <input
        ref={inputRef}
        className={styles.composerInput}
        value={title}
        placeholder="Task name"
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => {
          if (title.trim().length === 0) setOpen(false);
        }}
      />
      <div className={styles.composerActions}>
        <button
          type="button"
          className={styles.composerSave}
          disabled={pending}
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          {pending ? "Adding…" : "Save"}
        </button>
        <button
          type="button"
          className={styles.composerCancel}
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
