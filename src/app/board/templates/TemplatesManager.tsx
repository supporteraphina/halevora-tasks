"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createFromTemplateAction,
  deleteTemplateAction,
  type TemplateActionState,
} from "./actions";
import type { TemplateSummary } from "./data";
import styles from "./templates.module.css";

/**
 * Templates management surface. Lists every shared template, lets any user APPLY one to a
 * chosen board (spawning a task from the blueprint), and lets the author or a CEO DELETE one.
 * All mutations go through the re-authorizing server actions; this component only dispatches.
 */
export default function TemplatesManager({
  templates,
  boards,
  currentUserId,
  isCeo,
}: {
  templates: TemplateSummary[];
  boards: { id: string; name: string }[];
  currentUserId: string;
  isCeo: boolean;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Task templates</h1>
        <p className={styles.subtitle}>
          Reusable task blueprints. Apply one to any board to spawn a task with its
          checklists, custom-field values, and subtasks.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No templates yet</p>
          <p>
            Open a task, then choose <strong>Save as template</strong> to capture its
            shape for reuse.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              boards={boards}
              canDelete={isCeo || t.createdById === currentUserId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  boards,
  canDelete,
}: {
  template: TemplateSummary;
  boards: { id: string; name: string }[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [boardId, setBoardId] = useState(template.boardId ?? boards[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const meta: string[] = [];
  if (template.subtaskCount > 0)
    meta.push(`${template.subtaskCount} subtask${template.subtaskCount === 1 ? "" : "s"}`);
  if (template.checklistCount > 0)
    meta.push(
      `${template.checklistCount} checklist${template.checklistCount === 1 ? "" : "s"}`,
    );
  if (template.customFieldCount > 0)
    meta.push(
      `${template.customFieldCount} field${template.customFieldCount === 1 ? "" : "s"}`,
    );

  function apply() {
    if (!boardId) {
      setError("Pick a board.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("templateId", template.id);
    fd.set("boardId", boardId);
    startTransition(async () => {
      const result = await createFromTemplateAction({}, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.id) router.push(`/board/task/${result.id}`);
      else router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete the template "${template.name}"?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", template.id);
    startTransition(async () => {
      const result = await deleteTemplateAction({}, fd);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <li className={styles.card}>
      <div className={styles.cardMain}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardName}>{template.name}</h2>
          {canDelete ? (
            <button
              type="button"
              className={styles.deleteBtn}
              disabled={pending}
              aria-label={`Delete ${template.name}`}
              onClick={remove}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M2.5 3.5h9M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
        </div>

        {template.description ? (
          <p className={styles.cardDesc}>{template.description}</p>
        ) : null}

        <p className={styles.cardTaskTitle}>
          Spawns: <span>{template.taskTitle}</span>
        </p>

        <p className={styles.cardMeta}>
          {meta.length > 0 ? meta.join(" · ") : "Title, priority & description"}
          {template.createdByName ? ` · by ${template.createdByName}` : ""}
        </p>
      </div>

      <div className={styles.cardActions}>
        <label className={styles.applyLabel}>
          <span className={styles.applyLabelText}>Apply to</span>
          <select
            className={styles.boardSelect}
            value={boardId}
            disabled={pending || boards.length === 0}
            onChange={(e) => setBoardId(e.target.value)}
            aria-label="Target board"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.applyBtn}
          disabled={pending || boards.length === 0}
          onClick={apply}
        >
          {pending ? "Working…" : "Create task"}
        </button>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
