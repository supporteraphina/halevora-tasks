"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkSetStatusAction,
  bulkSetPriorityAction,
  bulkToggleAssigneeAction,
  bulkToggleTagAction,
  bulkArchiveAction,
  type BulkActionState,
} from "@/app/board/bulkActions";
import { STATUSES, type Status } from "@/domain/status";
import { PRIORITIES, type Priority } from "@/domain/priority";
import { summarizeBulk, parseBulkResult } from "@/domain/bulk";
import styles from "./BulkToolbar.module.css";

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

export interface BulkToolbarUser {
  id: string;
  name: string;
}
export interface BulkToolbarTag {
  id: string;
  name: string;
}

/**
 * The sticky batch-action bar, shared by the board cards and the §9 list views. It is purely
 * presentational + dispatch: it sends the selected ids to the re-authorizing bulk server
 * actions (each of which re-checks visibility per id, server-side), then clears the selection
 * and refreshes. The host owns selection state and passes it in.
 */
export default function BulkToolbar({
  selectedIds,
  users,
  tags,
  onClear,
}: {
  selectedIds: string[];
  users: BulkToolbarUser[];
  tags: BulkToolbarTag[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menu, setMenu] = useState<"status" | "priority" | "assignee" | "tag" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const count = selectedIds.length;

  // Close the open submenu on outside-click / Escape.
  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  // Auto-dismiss the result message.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message]);

  if (count === 0) return null;

  function run(
    action: (s: BulkActionState, fd: FormData) => Promise<BulkActionState>,
    fields: Record<string, string>,
    { keepSelection = false }: { keepSelection?: boolean } = {},
  ) {
    const fd = new FormData();
    fd.set("taskIds", JSON.stringify(selectedIds));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setMenu(null);
    startTransition(async () => {
      const result = await action({}, fd);
      if (result.error) {
        setMessage(result.error);
      } else if (result.result) {
        setMessage(summarizeBulk(parseBulkResult(result.result)));
      }
      router.refresh();
      if (!keepSelection && !result.error) onClear();
    });
  }

  return (
    <div className={styles.bar} role="region" aria-label="Bulk actions" ref={ref}>
      <div className={styles.left}>
        <span className={styles.count}>
          {count} selected
        </span>
        <button type="button" className={styles.clearBtn} onClick={onClear}>
          Clear
        </button>
      </div>

      <div className={styles.actions}>
        {/* Status */}
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={pending}
            aria-haspopup="listbox"
            aria-expanded={menu === "status"}
            onClick={() => setMenu(menu === "status" ? null : "status")}
          >
            Status
          </button>
          {menu === "status" ? (
            <div className={styles.menu} role="listbox" aria-label="Set status">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={styles.menuItem}
                  onClick={() => run(bulkSetStatusAction, { status: s })}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Priority */}
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={pending}
            aria-haspopup="listbox"
            aria-expanded={menu === "priority"}
            onClick={() => setMenu(menu === "priority" ? null : "priority")}
          >
            Priority
          </button>
          {menu === "priority" ? (
            <div className={styles.menu} role="listbox" aria-label="Set priority">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={styles.menuItem}
                  onClick={() => run(bulkSetPriorityAction, { priority: p })}
                >
                  <span
                    className={styles.prioDot}
                    style={{ background: `var(${PRIORITY_VAR[p]})` }}
                    aria-hidden="true"
                  />
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Assignee */}
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={pending}
            aria-haspopup="menu"
            aria-expanded={menu === "assignee"}
            onClick={() => setMenu(menu === "assignee" ? null : "assignee")}
          >
            Assignee
          </button>
          {menu === "assignee" ? (
            <div className={styles.menu} role="menu" aria-label="Add or remove assignee">
              <p className={styles.menuLabel}>Add / remove</p>
              {users.map((u) => (
                <div key={u.id} className={styles.menuRow}>
                  <span className={styles.menuRowName}>{u.name}</span>
                  <span className={styles.menuRowOps}>
                    <button
                      type="button"
                      className={styles.opBtn}
                      title={`Assign ${u.name}`}
                      aria-label={`Assign ${u.name}`}
                      onClick={() =>
                        run(
                          bulkToggleAssigneeAction,
                          { userId: u.id, op: "add" },
                          { keepSelection: true },
                        )
                      }
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={styles.opBtn}
                      title={`Unassign ${u.name}`}
                      aria-label={`Unassign ${u.name}`}
                      onClick={() =>
                        run(
                          bulkToggleAssigneeAction,
                          { userId: u.id, op: "remove" },
                          { keepSelection: true },
                        )
                      }
                    >
                      −
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Tag */}
        <div className={styles.menuWrap}>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={pending}
            aria-haspopup="menu"
            aria-expanded={menu === "tag"}
            onClick={() => setMenu(menu === "tag" ? null : "tag")}
          >
            Tag
          </button>
          {menu === "tag" ? (
            <TagMenu
              tags={tags}
              onAdd={(tagId, name) =>
                run(
                  bulkToggleTagAction,
                  name ? { op: "add", name } : { op: "add", tagId },
                  { keepSelection: true },
                )
              }
              onRemove={(tagId) =>
                run(bulkToggleTagAction, { op: "remove", tagId }, { keepSelection: true })
              }
            />
          ) : null}
        </div>

        {/* Archive */}
        <button
          type="button"
          className={styles.dangerBtn}
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                `Archive ${count} task${count === 1 ? "" : "s"}? They leave the board but are not deleted.`,
              )
            ) {
              run(bulkArchiveAction, {});
            }
          }}
        >
          Archive
        </button>
      </div>

      {message ? (
        <span className={styles.message} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

function TagMenu({
  tags,
  onAdd,
  onRemove,
}: {
  tags: BulkToolbarTag[];
  onAdd: (tagId: string, name?: string) => void;
  onRemove: (tagId: string) => void;
}) {
  const [newTag, setNewTag] = useState("");
  return (
    <div className={styles.menu} role="menu" aria-label="Add or remove tag">
      <p className={styles.menuLabel}>Add / remove</p>
      {tags.map((t) => (
        <div key={t.id} className={styles.menuRow}>
          <span className={styles.menuRowName}>{t.name}</span>
          <span className={styles.menuRowOps}>
            <button
              type="button"
              className={styles.opBtn}
              title={`Add tag ${t.name}`}
              aria-label={`Add tag ${t.name}`}
              onClick={() => onAdd(t.id)}
            >
              +
            </button>
            <button
              type="button"
              className={styles.opBtn}
              title={`Remove tag ${t.name}`}
              aria-label={`Remove tag ${t.name}`}
              onClick={() => onRemove(t.id)}
            >
              −
            </button>
          </span>
        </div>
      ))}
      <form
        className={styles.tagCreate}
        onSubmit={(e) => {
          e.preventDefault();
          const name = newTag.trim();
          if (!name) return;
          setNewTag("");
          onAdd("", name);
        }}
      >
        <input
          className={styles.tagInput}
          placeholder="New tag…"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          aria-label="New tag name to add to selected tasks"
        />
        <button type="submit" className={styles.smallBtn}>
          Add
        </button>
      </form>
    </div>
  );
}
