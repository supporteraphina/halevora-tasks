"use client";

import {
  useState,
  useTransition,
  useRef,
  useEffect,
  useMemo,
  useOptimistic,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/useRealtime";
import {
  createTaskAction,
  changeStatusAction,
  moveCardAction,
  createBoardAction,
} from "./actions";
import {
  STATUS_GROUPS,
  badgeFor,
  type BadgeKey,
} from "@/domain/statusGroups";
import { moveTargets, moveTargetLabel } from "@/domain/moveTargets";
import type { Status, Priority } from "@prisma/client";
import type { BoardColumn, BoardCard } from "./data";
import BulkToolbar, {
  type BulkToolbarUser,
  type BulkToolbarTag,
} from "@/components/BulkToolbar";
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

// ---------------------------------------------------------------------------
//  Optimistic board reducer
//
//  Applied OVER the server `columns` prop via React 19 `useOptimistic`. Each hot
//  interaction dispatches an action that returns a NEW columns array with the change
//  already applied, so the UI updates the instant the user acts. The matching server
//  action persists in the background; when `router.refresh()` lands the fresh RSC
//  payload, `useOptimistic` discards these overlays and the real data shows through —
//  no revert-then-reapply flash, because the refresh runs inside the same transition.
//  If the action rejects (e.g. the Done-gate), the overlay is dropped on settle and the
//  card snaps back to its true status; the handler surfaces the error toast.
// ---------------------------------------------------------------------------

type OptimisticAction =
  | { type: "status"; taskId: string; status: Status }
  | { type: "move"; taskId: string; toBoardId: string; index: number }
  | { type: "create"; boardId: string; card: BoardCard };

/**
 * Apply one optimistic action to the columns. Pure: returns a fresh array, never mutates.
 * Mirrors the server's observable effect closely enough to look right until the refresh
 * reconciles — it is presentation only and trusts nothing the server wouldn't re-check.
 */
function applyOptimisticAction(
  cols: BoardColumn[],
  action: OptimisticAction,
): BoardColumn[] {
  switch (action.type) {
    case "status": {
      // A card set to REVIEWED leaves the board grid (mirrors the loader's filter).
      const leaves = action.status === "REVIEWED";
      return cols.map((col) => {
        if (!col.cards.some((c) => c.id === action.taskId)) return col;
        const cards = leaves
          ? col.cards.filter((c) => c.id !== action.taskId)
          : col.cards.map((c) =>
              c.id === action.taskId ? { ...c, status: action.status } : c,
            );
        return { ...col, cards };
      });
    }
    case "move": {
      // Pull the card out of whatever column holds it, then insert at `index` in the dest.
      let moved: BoardCard | undefined;
      const without = cols.map((col) => {
        const found = col.cards.find((c) => c.id === action.taskId);
        if (found) moved = found;
        return found
          ? { ...col, cards: col.cards.filter((c) => c.id !== action.taskId) }
          : col;
      });
      if (!moved) return cols;
      const card = moved;
      return without.map((col) => {
        if (col.id !== action.toBoardId) return col;
        // Give the card a fractional order between its new neighbours so the sort is stable.
        const neighbours = col.cards;
        const i = Math.max(0, Math.min(action.index, neighbours.length));
        const before = neighbours[i - 1]?.order;
        const afterCard = neighbours[i]?.order;
        let order: number;
        if (neighbours.length === 0) order = 1000;
        else if (i === 0) order = (afterCard ?? 1000) / 2;
        else if (i >= neighbours.length) order = (before ?? 0) + 1000;
        else order = ((before ?? 0) + (afterCard ?? 0)) / 2;
        const placed: BoardCard = { ...card, boardId: action.toBoardId, order };
        const next = [...neighbours];
        next.splice(i, 0, placed);
        return { ...col, cards: next };
      });
    }
    case "create": {
      return cols.map((col) =>
        col.id === action.boardId
          ? { ...col, cards: [...col.cards, action.card] }
          : col,
      );
    }
    default:
      return cols;
  }
}

/** A unique-enough temp id for an optimistic new card; replaced by the real row on refresh. */
let tempSeq = 0;
function makeTempCard(boardId: string, title: string): BoardCard {
  tempSeq += 1;
  return {
    id: `temp-${Date.now()}-${tempSeq}`,
    title,
    status: "TODO",
    priority: "NORMAL",
    dueAt: null,
    startAt: null,
    // Sort to the end of the column, matching the server's append-order.
    order: Number.MAX_SAFE_INTEGER,
    boardId,
    assignees: [],
    subtaskCount: 0,
    openBlockerCount: 0,
  };
}

export default function Board({
  columns,
  isCeo,
  users,
  tags,
}: {
  columns: BoardColumn[];
  isCeo: boolean;
  users: BulkToolbarUser[];
  tags: BulkToolbarTag[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic overlay on the server columns. Dispatches MUST run inside a transition
  // (they do — every handler wraps them in `startTransition`). The overlay is discarded
  // automatically when the transition settles and the refreshed RSC payload arrives.
  const [optimisticColumns, applyOptimistic] = useOptimistic(
    columns,
    applyOptimisticAction,
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  // Transient error surfaced when a move/reorder is rejected server-side.
  const [moveError, setMoveError] = useState<string | null>(null);
  // Index within a column where a drop would land, for the insertion indicator.
  const [dropTarget, setDropTarget] = useState<{
    boardId: string;
    index: number;
  } | null>(null);
  // Multi-select state across all columns.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Live board: subscribe to every visible board column. A task event (create/move/status/
  // bulk/detail change) for a board the viewer can see prompts a server refresh — the SSE
  // relay has already authorized the event per subscriber, so a member never gets a refresh
  // signal for a task they can't see. The refresh is DEBOUNCED so a burst (a bulk edit, a
  // few active teammates, or the echo of your own edit landing on top of its action's
  // refresh) coalesces into ONE refetch instead of a storm. Realtime is additive: if the
  // stream drops, manual reload still works.
  const boardIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtime(boardIds, (event) => {
    if (event.type !== "task") return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  });
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  const now = new Date();

  // Drop ids no longer on the board (moved away / refreshed).
  useEffect(() => {
    const present = new Set<string>();
    for (const col of columns) for (const c of col.cards) present.add(c.id);
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (present.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [columns]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runMove(taskId: string, toBoardId: string, index: number) {
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("toBoardId", toBoardId);
    fd.set("index", String(index));
    startTransition(async () => {
      applyOptimistic({ type: "move", taskId, toBoardId, index }); // instant
      const result = await moveCardAction({}, fd); // persist in background
      if (result?.error) setMoveError(result.error);
      router.refresh(); // reconcile inside the same transition (no flash)
    });
  }

  // Lifted status-change handler: the optimistic dispatch lives here so it shares the
  // transition with the action + refresh. Returns the action's error (if any) to the
  // badge, which owns the local error toast.
  function runStatusChange(
    taskId: string,
    status: Status,
  ): Promise<string | null> {
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("status", status);
    return new Promise((resolve) => {
      startTransition(async () => {
        applyOptimistic({ type: "status", taskId, status }); // instant
        const result = await changeStatusAction({}, fd); // persist
        router.refresh(); // reconcile (reverts the overlay if the action refused)
        resolve(result?.error ?? null);
      });
    });
  }

  // Lifted create-task handler: drops a temp card into the column immediately; the refresh
  // brings the real row and the temp overlay falls away.
  function runCreateTask(
    boardId: string,
    title: string,
  ): Promise<string | null> {
    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("title", title);
    return new Promise((resolve) => {
      startTransition(async () => {
        applyOptimistic({
          type: "create",
          boardId,
          card: makeTempCard(boardId, title),
        });
        const result = await createTaskAction({}, fd);
        router.refresh();
        resolve(result?.error ?? null);
      });
    });
  }

  // Auto-clear the move error after a few seconds.
  useEffect(() => {
    if (!moveError) return;
    const t = setTimeout(() => setMoveError(null), 4000);
    return () => clearTimeout(t);
  }, [moveError]);

  // Targets for the keyboard "Move to…" menu: top/bottom of each board column. Derived from
  // the OPTIMISTIC columns so a "bottom" index reflects what the user currently sees.
  const moveBoards = useMemo(
    () =>
      optimisticColumns.map((c) => ({
        id: c.id,
        name: c.name,
        cardCount: c.cards.length,
      })),
    [optimisticColumns],
  );

  function onDrop(boardId: string, index: number) {
    if (!drag) return;
    runMove(drag.taskId, boardId, index);
    setDrag(null);
    setDropTarget(null);
  }

  function moveCardTo(taskId: string, fromBoardId: string, toBoardId: string, index: number) {
    runMove(taskId, toBoardId, index);
    void fromBoardId;
  }

  return (
    <div className={styles.boardScroll} data-pending={pending || undefined}>
      {optimisticColumns.length === 0 ? (
        <EmptyBoard />
      ) : (
        <div className={styles.columns}>
          {optimisticColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              isCeo={isCeo}
              now={now}
              drag={drag}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              selected={selected}
              onToggleSelect={toggleSelect}
              moveBoards={moveBoards}
              onMoveTo={moveCardTo}
              onChangeStatus={runStatusChange}
              onCreateTask={runCreateTask}
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
          <AddBoardColumn />
        </div>
      )}

      {moveError ? (
        <div className={styles.moveToast} role="alert">
          {moveError}
        </div>
      ) : null}

      <BulkToolbar
        selectedIds={[...selected]}
        users={users}
        tags={tags}
        onClear={() => setSelected(new Set())}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Empty state + create-board affordances
// ---------------------------------------------------------------------------

function EmptyBoard() {
  return (
    <div className={styles.emptyBoard}>
      <div className={styles.emptyArt} aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect x="4" y="7" width="9" height="26" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <rect x="15.5" y="7" width="9" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <rect x="27" y="7" width="9" height="22" rx="2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <h2 className={styles.emptyTitle}>Start your first board</h2>
      <p className={styles.emptyNote}>
        Boards are your columns. Create one for a team, a client, or a workstream, then add tasks.
      </p>
      <CreateBoard variant="primary" />
    </div>
  );
}

function AddBoardColumn() {
  return (
    <div className={styles.addBoardCol}>
      <CreateBoard variant="ghost" />
    </div>
  );
}

function CreateBoard({ variant }: { variant: "primary" | "ghost" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit() {
    const value = name.trim();
    if (value.length === 0) {
      setOpen(false);
      return;
    }
    const fd = new FormData();
    fd.set("name", value);
    startTransition(async () => {
      const result = await createBoardAction({}, fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setName("");
      setOpen(false);
      setError(null);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className={variant === "primary" ? styles.emptyCreateBtn : styles.addBoardBtn}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">+</span> {variant === "primary" ? "Create a board" : "Add board"}
      </button>
    );
  }

  return (
    <div className={styles.boardComposer}>
      <input
        ref={inputRef}
        className={styles.composerInput}
        value={name}
        placeholder="Board name"
        disabled={pending}
        aria-label="Board name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setOpen(false);
            setName("");
            setError(null);
          }
        }}
      />
      {error ? (
        <p className={styles.composerError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.composerActions}>
        <button
          type="button"
          className={styles.composerSave}
          disabled={pending}
          onClick={submit}
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          className={styles.composerCancel}
          onClick={() => {
            setOpen(false);
            setName("");
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface MoveBoard {
  id: string;
  name: string;
  cardCount: number;
}

function Column({
  column,
  isCeo,
  now,
  drag,
  dropTarget,
  setDropTarget,
  selected,
  onToggleSelect,
  moveBoards,
  onMoveTo,
  onChangeStatus,
  onCreateTask,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  column: BoardColumn;
  isCeo: boolean;
  now: Date;
  drag: DragState | null;
  dropTarget: { boardId: string; index: number } | null;
  setDropTarget: (t: { boardId: string; index: number } | null) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  moveBoards: MoveBoard[];
  onMoveTo: (taskId: string, fromBoardId: string, toBoardId: string, index: number) => void;
  onChangeStatus: (taskId: string, status: Status) => Promise<string | null>;
  onCreateTask: (boardId: string, title: string) => Promise<string | null>;
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
        {isCeo ? (
          <Link
            href={`/board/automation/${column.id}`}
            className={styles.colAutomation}
            title={`Automations for ${column.name}`}
            aria-label={`Automations for ${column.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        ) : null}
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
              selected={selected.has(card.id)}
              onToggleSelect={onToggleSelect}
              moveBoards={moveBoards}
              fromBoardId={column.id}
              onMoveTo={onMoveTo}
              onChangeStatus={onChangeStatus}
              onDragStart={() => onDragStart(card.id)}
              onDragEnd={onDragEnd}
            />
          </div>
        ))}
        {showIndicatorAt === column.cards.length ? (
          <div className={styles.dropLine} aria-hidden="true" />
        ) : null}
      </div>

      <AddTask boardId={column.id} onCreateTask={onCreateTask} />
    </section>
  );
}

function Card({
  card,
  now,
  dragging,
  selected,
  onToggleSelect,
  moveBoards,
  fromBoardId,
  onMoveTo,
  onChangeStatus,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  now: Date;
  dragging: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  moveBoards: MoveBoard[];
  fromBoardId: string;
  onMoveTo: (taskId: string, fromBoardId: string, toBoardId: string, index: number) => void;
  onChangeStatus: (taskId: string, status: Status) => Promise<string | null>;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const router = useRouter();
  const badge = badgeFor(card, now);
  const prio = PRIORITY_META[card.priority];
  // A just-created optimistic card has no real row yet — don't let it navigate, drag, or
  // change status until the refresh swaps in the real id.
  const isTemp = card.id.startsWith("temp-");

  // Open the detail panel. Skip if the click landed on an interactive control
  // (the status badge button / its menu / the select checkbox), so those keep their behavior.
  function openDetail(e: React.MouseEvent) {
    if (isTemp) return;
    if ((e.target as HTMLElement).closest("button,a,input,label,[role='listbox'],[role='menu']")) return;
    router.push(`/board/task/${card.id}`);
  }

  return (
    <article
      className={styles.card}
      data-dragging={dragging || undefined}
      data-selected={selected || undefined}
      data-temp={isTemp || undefined}
      aria-busy={isTemp || undefined}
      draggable={!isTemp}
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onMouseEnter={() => {
        // Warm the task detail (route + data) on hover so the panel is ready on click.
        if (!isTemp) router.prefetch(`/board/task/${card.id}`);
      }}
      onFocus={() => {
        if (!isTemp) router.prefetch(`/board/task/${card.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!isTemp) router.push(`/board/task/${card.id}`);
        }
      }}
      onDragStart={(e) => {
        if (isTemp) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className={styles.cardTop}>
        <label
          className={styles.cardSelect}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className={styles.cardCheckbox}
            checked={selected}
            draggable={false}
            onChange={() => onToggleSelect(card.id)}
            aria-label={`Select ${card.title}`}
          />
        </label>
        <p className={styles.cardTitle}>{card.title}</p>
        <MoveMenu
          card={card}
          moveBoards={moveBoards}
          fromBoardId={fromBoardId}
          onMoveTo={onMoveTo}
        />
      </div>

      <div className={styles.cardMeta}>
        <StatusBadge
          taskId={card.id}
          badgeKey={badge.key}
          label={badge.label}
          disabled={isTemp}
          onChangeStatus={onChangeStatus}
        />

        {card.openBlockerCount > 0 ? (
          <span
            className={styles.blocked}
            title={`Blocked by ${card.openBlockerCount} open task${
              card.openBlockerCount === 1 ? "" : "s"
            }`}
            aria-label={`Blocked by ${card.openBlockerCount} open task${
              card.openBlockerCount === 1 ? "" : "s"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3.4 3.4l7.2 7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Blocked
          </span>
        ) : null}

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

/**
 * Keyboard-accessible alternative to drag-and-drop: a "Move to…" menu that sends the card to
 * the top or bottom of any board column. Drag-and-drop has no keyboard path, so this menu is
 * the a11y route for reordering and cross-board moves. Fully operable by keyboard (button +
 * native focusable menu items + Escape to close).
 */
function MoveMenu({
  card,
  moveBoards,
  fromBoardId,
  onMoveTo,
}: {
  card: BoardCard;
  moveBoards: MoveBoard[];
  fromBoardId: string;
  onMoveTo: (taskId: string, fromBoardId: string, toBoardId: string, index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const targets = useMemo(
    () => moveTargets(moveBoards, fromBoardId, card.id),
    [moveBoards, fromBoardId, card.id],
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus(); // restore focus to the trigger
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className={styles.moveWrap} ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={styles.moveBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move "${card.title}" to another board`}
        title="Move to…"
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="3" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="13" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div className={styles.moveMenu} role="menu" aria-label="Move to board">
          <p className={styles.moveMenuLabel}>Move to</p>
          {targets.map((t) => (
            <button
              key={`${t.boardId}-${t.position}`}
              type="button"
              role="menuitem"
              className={styles.moveOption}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onMoveTo(card.id, fromBoardId, t.boardId, t.index);
              }}
            >
              {moveTargetLabel(t)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({
  taskId,
  badgeKey,
  label,
  disabled,
  onChangeStatus,
}: {
  taskId: string;
  badgeKey: BadgeKey;
  label: string;
  disabled?: boolean;
  onChangeStatus: (taskId: string, status: Status) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  // `busy` only disables the trigger while the parent transition runs; the optimistic
  // overlay + refresh both live in the lifted `onChangeStatus`, so the badge updates instantly.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Clear a transient error message after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  function choose(status: Status) {
    setOpen(false);
    setError(null);
    setBusy(true);
    // The parent applies the optimistic status (instant badge update), persists, and
    // refreshes; it resolves the Done-gate error (if any). On refusal the overlay reverts
    // to the truth and we surface the message in the existing toast.
    onChangeStatus(taskId, status)
      .then((err) => {
        if (err) setError(err);
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className={styles.badgeWrap} ref={ref}>
      <button
        type="button"
        className={styles.badge}
        data-tone={tone}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || busy}
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

      {error ? (
        <span className={styles.blockedToast} role="alert">
          {error}
        </span>
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

function AddTask({
  boardId,
  onCreateTask,
}: {
  boardId: string;
  onCreateTask: (boardId: string, title: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  function submit() {
    const value = title.trim();
    if (value.length === 0) {
      setOpen(false);
      return;
    }
    // Optimistic: the temp card appears the instant we dispatch (inside onCreateTask).
    // Clear the field and keep the composer open right away for fast multi-entry — the
    // background persist + refresh swaps the temp card for the real row.
    setTitle("");
    setError(null);
    inputRef.current?.focus();
    onCreateTask(boardId, value).then((err) => {
      if (err) setError(err);
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
      {error ? (
        <p className={styles.composerError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.composerActions}>
        <button
          type="button"
          className={styles.composerSave}
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          Save
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
