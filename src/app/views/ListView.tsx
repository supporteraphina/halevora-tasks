"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  applyView,
  SORT_KEYS,
  SORT_LABELS,
  type SortClause,
  type SortKey,
  type ViewFilter,
} from "@/domain/views";
import { badgeFor, type BadgeKey } from "@/domain/statusGroups";
import { PRIORITIES, type Priority } from "@/domain/priority";
import { STATUSES, type Status } from "@/domain/status";
import { formatInZone } from "@/domain/dates";
import {
  createSavedViewAction,
  deleteSavedViewAction,
  type ViewActionState,
} from "./actions";
import type { ViewTaskRow } from "./data";
import type { SavedViewSummary, ViewKind } from "./savedViews";
import styles from "./views.module.css";

const BADGE_VARS: Record<BadgeKey, string> = {
  TODO: "todo",
  IN_PROGRESS: "progress",
  DONE: "done",
  REVIEWED: "reviewed",
  OVERDUE: "overdue",
};

const STATUS_LABEL: Record<Status, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low",
};

const PRIORITY_VAR: Record<Priority, string> = {
  URGENT: "--prio-urgent",
  HIGH: "--prio-high",
  NORMAL: "--prio-normal",
  LOW: "--prio-low",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function countActiveFacets(f: ViewFilter): number {
  let n = 0;
  if (f.statuses?.length) n++;
  if (f.priorities?.length) n++;
  if (f.assigneeIds?.length) n++;
  if (f.tagIds?.length) n++;
  if (f.hasDue) n++;
  if (f.overdue) n++;
  return n;
}

export interface ListViewProps {
  title: string;
  subtitle: string;
  kind: ViewKind;
  tasks: ViewTaskRow[];
  timezone: string;
  options: {
    users: { id: string; name: string }[];
    tags: { id: string; name: string }[];
  };
  savedViews: SavedViewSummary[];
  /** The currently-open saved view, if any (its config seeds sort/filter). */
  activeView?: SavedViewSummary | null;
  /** Group rows by their board column (the My-Tasks / All view default). */
  groupByBoard?: boolean;
  /** Whether the current actor may save an All-CEO view (CEO only). */
  canSaveAll?: boolean;
}

export default function ListView({
  title,
  subtitle,
  kind,
  tasks,
  timezone,
  options,
  savedViews,
  activeView = null,
  groupByBoard = false,
  canSaveAll = false,
}: ListViewProps) {
  const router = useRouter();
  const now = useMemo(() => new Date(), []);

  const [sort, setSort] = useState<SortClause[]>(activeView?.config.sort ?? []);
  const [filter, setFilter] = useState<ViewFilter>(
    activeView?.config.filter ?? {},
  );
  const [openMenu, setOpenMenu] = useState<"sort" | "filter" | "save" | null>(
    null,
  );

  const sorted = useMemo(
    () => applyView(tasks, filter, sort, now),
    [tasks, filter, sort, now],
  );

  const activeFacetCount = countActiveFacets(filter);

  function clearAll() {
    setSort([]);
    setFilter({});
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
      </div>

      <SavedViewTabs
        kind={kind}
        savedViews={savedViews}
        activeViewId={activeView?.id ?? null}
      />

      <div className={styles.toolbar}>
        <SortControl
          open={openMenu === "sort"}
          onToggle={() => setOpenMenu(openMenu === "sort" ? null : "sort")}
          onClose={() => setOpenMenu(null)}
          sort={sort}
          setSort={setSort}
        />
        <FilterControl
          open={openMenu === "filter"}
          onToggle={() => setOpenMenu(openMenu === "filter" ? null : "filter")}
          onClose={() => setOpenMenu(null)}
          filter={filter}
          setFilter={setFilter}
          options={options}
          activeCount={activeFacetCount}
        />
        {(sort.length > 0 || activeFacetCount > 0) && (
          <button type="button" className={styles.clearBtn} onClick={clearAll}>
            Clear
          </button>
        )}

        <div className={styles.toolSpacer} />

        <SaveViewControl
          open={openMenu === "save"}
          onToggle={() => setOpenMenu(openMenu === "save" ? null : "save")}
          onClose={() => setOpenMenu(null)}
          kind={kind}
          filter={filter}
          sort={sort}
          canSaveAll={canSaveAll}
          onSaved={(id) => {
            setOpenMenu(null);
            router.push(viewHref(kind, id));
          }}
        />
      </div>

      <div className={styles.scroll}>
        {sorted.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No tasks here</p>
            <p>
              {tasks.length === 0
                ? "Nothing is assigned to this view yet."
                : "No tasks match the current filters."}
            </p>
          </div>
        ) : groupByBoard ? (
          <GroupedRows tasks={sorted} now={now} timezone={timezone} />
        ) : (
          <div className={styles.group}>
            <div className={styles.rows}>
              {sorted.map((t) => (
                <TaskRow key={t.id} task={t} now={now} timezone={timezone} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Build the href for a base view + optional saved-view id. */
function viewHref(kind: ViewKind, viewId?: string): string {
  const base: Record<ViewKind, string> = {
    my_tasks: "/my-tasks",
    all: "/all-tasks",
    today: "/today",
    reviewed: "/reviewed",
    calendar: "/calendar",
  };
  const path = base[kind];
  return viewId ? `${path}?view=${viewId}` : path;
}

function SavedViewTabs({
  kind,
  savedViews,
  activeViewId,
}: {
  kind: ViewKind;
  savedViews: SavedViewSummary[];
  activeViewId: string | null;
}) {
  const router = useRouter();
  const mine = savedViews.filter((v) => v.kind === kind);

  function remove(id: string) {
    if (!confirm("Delete this saved view?")) return;
    const fd = new FormData();
    fd.set("id", id);
    deleteSavedViewAction({}, fd).then(() => router.refresh());
  }

  return (
    <div className={styles.viewTabs}>
      <button
        type="button"
        className={styles.viewTab}
        data-active={activeViewId === null}
        onClick={() => router.push(viewHref(kind))}
      >
        Default
      </button>
      {mine.map((v) => (
        <span key={v.id} style={{ display: "inline-flex" }}>
          <button
            type="button"
            className={styles.viewTab}
            data-active={activeViewId === v.id}
            onClick={() => router.push(viewHref(kind, v.id))}
          >
            {v.name}
            {activeViewId === v.id && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${v.name}`}
                className={styles.viewTabDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(v.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    remove(v.id);
                  }
                }}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M3 3l6 6M9 3l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            )}
          </button>
        </span>
      ))}
    </div>
  );
}

function usePopoverClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);
  return ref;
}

function SortControl({
  open,
  onToggle,
  onClose,
  sort,
  setSort,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  sort: SortClause[];
  setSort: (s: SortClause[]) => void;
}) {
  const ref = usePopoverClose(open, onClose);
  const usedKeys = new Set(sort.map((c) => c.key));
  const available = SORT_KEYS.filter((k) => !usedKeys.has(k));

  function addClause() {
    if (available.length === 0) return;
    setSort([...sort, { key: available[0], dir: "asc" }]);
  }
  function setKey(i: number, key: SortKey) {
    setSort(sort.map((c, j) => (j === i ? { ...c, key } : c)));
  }
  function toggleDir(i: number) {
    setSort(
      sort.map((c, j) =>
        j === i ? { ...c, dir: c.dir === "asc" ? "desc" : "asc" } : c,
      ),
    );
  }
  function remove(i: number) {
    setSort(sort.filter((_, j) => j !== i));
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={styles.toolBtn}
        data-active={sort.length > 0 || undefined}
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4h8M4 8h5M4 12h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        Sort
        {sort.length > 0 && <span className={styles.toolBtnCount}>{sort.length}</span>}
      </button>
      {open && (
        <div className={styles.popover} style={{ left: 0 }}>
          <p className={styles.popoverTitle}>Sort by</p>
          {sort.map((clause, i) => (
            <div key={clause.key} className={styles.sortClause}>
              <select
                value={clause.key}
                onChange={(e) => setKey(i, e.target.value as SortKey)}
                aria-label={`Sort key ${i + 1}`}
              >
                {SORT_KEYS.filter(
                  (k) => k === clause.key || !usedKeys.has(k),
                ).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.dirBtn}
                onClick={() => toggleDir(i)}
                aria-label={`Direction ${clause.dir === "asc" ? "ascending" : "descending"}`}
              >
                {clause.dir === "asc" ? "Asc" : "Desc"}
              </button>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => remove(i)}
                aria-label={`Remove sort ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
          {available.length > 0 && (
            <button type="button" className={styles.addClauseBtn} onClick={addClause}>
              + Add sort
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterControl({
  open,
  onToggle,
  onClose,
  filter,
  setFilter,
  options,
  activeCount,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  filter: ViewFilter;
  setFilter: (f: ViewFilter) => void;
  options: { users: { id: string; name: string }[]; tags: { id: string; name: string }[] };
  activeCount: number;
}) {
  const ref = usePopoverClose(open, onClose);

  function toggleArr<T>(arr: T[] | undefined, value: T): T[] {
    const cur = arr ?? [];
    return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={styles.toolBtn}
        data-active={activeCount > 0 || undefined}
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5L2 3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        Filter
        {activeCount > 0 && <span className={styles.toolBtnCount}>{activeCount}</span>}
      </button>
      {open && (
        <div className={styles.popover} style={{ left: 0 }}>
          <div className={styles.facetGroup}>
            <p className={styles.facetGroupLabel}>Status</p>
            <div className={styles.chips}>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.chip}
                  data-on={filter.statuses?.includes(s) || undefined}
                  onClick={() =>
                    setFilter({ ...filter, statuses: toggleArr(filter.statuses, s) })
                  }
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.facetGroup}>
            <p className={styles.facetGroupLabel}>Priority</p>
            <div className={styles.chips}>
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles.chip}
                  data-on={filter.priorities?.includes(p) || undefined}
                  onClick={() =>
                    setFilter({ ...filter, priorities: toggleArr(filter.priorities, p) })
                  }
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.facetGroup}>
            <p className={styles.facetGroupLabel}>Assignee</p>
            <select
              className={styles.facetSelect}
              value=""
              onChange={(e) => {
                if (e.target.value)
                  setFilter({
                    ...filter,
                    assigneeIds: toggleArr(filter.assigneeIds, e.target.value),
                  });
              }}
              aria-label="Add assignee filter"
            >
              <option value="">Add assignee…</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {filter.assigneeIds?.includes(u.id) ? "✓ " : ""}
                  {u.name}
                </option>
              ))}
            </select>
            {filter.assigneeIds && filter.assigneeIds.length > 0 && (
              <div className={styles.chips}>
                {filter.assigneeIds.map((id) => {
                  const u = options.users.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={styles.chip}
                      data-on="true"
                      onClick={() =>
                        setFilter({ ...filter, assigneeIds: toggleArr(filter.assigneeIds, id) })
                      }
                    >
                      {u?.name ?? id} ✕
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {options.tags.length > 0 && (
            <div className={styles.facetGroup}>
              <p className={styles.facetGroupLabel}>Tag</p>
              <div className={styles.chips}>
                {options.tags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.chip}
                    data-on={filter.tagIds?.includes(t.id) || undefined}
                    onClick={() =>
                      setFilter({ ...filter, tagIds: toggleArr(filter.tagIds, t.id) })
                    }
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.facetGroup}>
            <p className={styles.facetGroupLabel}>Quick</p>
            <div className={styles.chips}>
              <button
                type="button"
                className={styles.chip}
                data-on={filter.hasDue || undefined}
                onClick={() => setFilter({ ...filter, hasDue: !filter.hasDue })}
              >
                Has due date
              </button>
              <button
                type="button"
                className={styles.chip}
                data-on={filter.overdue || undefined}
                onClick={() => setFilter({ ...filter, overdue: !filter.overdue })}
              >
                Overdue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveViewControl({
  open,
  onToggle,
  onClose,
  kind,
  filter,
  sort,
  canSaveAll,
  onSaved,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  kind: ViewKind;
  filter: ViewFilter;
  sort: SortClause[];
  canSaveAll: boolean;
  onSaved: (id: string) => void;
}) {
  const ref = usePopoverClose(open, onClose);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A MEMBER can never save an All-CEO view (the kind is CEO-only).
  if (kind === "all" && !canSaveAll) return null;

  function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Name your view first.");
      return;
    }
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("name", trimmed);
    fd.set("kind", kind);
    fd.set("filter", JSON.stringify(filter));
    fd.set("sort", JSON.stringify(sort));
    createSavedViewAction({}, fd).then((res: ViewActionState) => {
      setPending(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setName("");
      if (res.viewId) onSaved(res.viewId);
    });
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className={styles.toolBtn}
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add view
      </button>
      {open && (
        <div className={styles.popover} style={{ right: 0 }}>
          <p className={styles.popoverTitle}>Save current sort + filter</p>
          <div className={styles.saveForm}>
            <input
              className={styles.saveInput}
              placeholder="View name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
            />
            {error && <p className={styles.errorText}>{error}</p>}
            <div className={styles.saveActions}>
              <button
                type="button"
                className={styles.saveBtn}
                disabled={pending}
                onClick={save}
              >
                {pending ? "Saving…" : "Save view"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedRows({
  tasks,
  now,
  timezone,
}: {
  tasks: ViewTaskRow[];
  now: Date;
  timezone: string;
}) {
  // Preserve the sorted order while bucketing by board.
  const groups: { id: string; name: string; color: string | null; rows: ViewTaskRow[] }[] = [];
  const index = new Map<string, number>();
  for (const t of tasks) {
    let gi = index.get(t.boardId);
    if (gi === undefined) {
      gi = groups.length;
      index.set(t.boardId, gi);
      groups.push({ id: t.boardId, name: t.boardName, color: t.boardColor, rows: [] });
    }
    groups[gi].rows.push(t);
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.id} className={styles.group}>
          <div className={styles.groupHeader}>
            <span
              className={styles.groupDot}
              style={{ background: g.color ?? "var(--ink-subtle)" }}
              aria-hidden="true"
            />
            <span className={styles.groupName}>{g.name}</span>
            <span className={styles.groupCount}>{g.rows.length}</span>
          </div>
          <div className={styles.rows}>
            {g.rows.map((t) => (
              <TaskRow key={t.id} task={t} now={now} timezone={timezone} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function TaskRow({
  task,
  now,
  timezone,
}: {
  task: ViewTaskRow;
  now: Date;
  timezone: string;
}) {
  const router = useRouter();
  const badge = badgeFor(task, now);
  const tone = BADGE_VARS[badge.key];

  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => router.push(`/board/task/${task.id}`)}
    >
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{task.title}</span>
        <span className={styles.rowSub}>
          <span className={styles.rowBoard}>
            <span
              className={styles.groupDot}
              style={{ background: task.boardColor ?? "var(--ink-subtle)" }}
              aria-hidden="true"
            />
            {task.boardName}
          </span>
          {task.subtaskCount > 0 && (
            <span>· {task.subtaskCount} subtask{task.subtaskCount === 1 ? "" : "s"}</span>
          )}
        </span>
      </div>

      <div className={styles.rowMeta}>
        <span className={styles.badge} data-tone={tone}>
          <span className={styles.badgeDot} data-tone={tone} aria-hidden="true" />
          {badge.label}
        </span>

        {task.priority !== "NORMAL" && (
          <span
            className={styles.prioFlag}
            style={{ color: `var(${PRIORITY_VAR[task.priority]})` }}
            title={`${PRIORITY_LABEL[task.priority]} priority`}
            aria-label={`${PRIORITY_LABEL[task.priority]} priority`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 1v10M3 1h6l-1.2 2L9 5H3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </span>
        )}

        {task.dueAt && (
          <span className={styles.rowDue} data-overdue={badge.key === "OVERDUE"}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.5 5.5h11M4.5 1v2M9.5 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {formatInZone(task.dueAt, timezone)}
          </span>
        )}

        {task.assignees.length > 0 && (
          <span className={styles.avatars}>
            {task.assignees.slice(0, 3).map((a) => (
              <span key={a.id} className={styles.avatar} title={a.name} aria-label={a.name}>
                {initials(a.name)}
              </span>
            ))}
          </span>
        )}
      </div>
    </button>
  );
}
