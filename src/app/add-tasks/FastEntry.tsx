"use client";

import { useState, useRef, useEffect } from "react";
import { quickCreateTaskAction, type ViewActionState } from "@/app/views/actions";
import styles from "@/app/views/views.module.css";

interface BoardOption {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Fast-entry composer: type a title, press Enter to create the task into the chosen board,
 * the input clears and KEEPS focus for the next one (ClickUp "Add Tasks Quickly"). Each
 * create goes through the scoped, authorized `quickCreateTaskAction` (delegates to the
 * board's createTaskAction). The session list is client-only feedback for what you just made.
 */
export default function FastEntry({ boards }: { boards: BoardOption[] }) {
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ title: string; board: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    const value = title.trim();
    if (value.length === 0) return;
    if (!boardId) {
      setError("Pick a board first.");
      return;
    }
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("title", value);
    quickCreateTaskAction({}, fd).then((res: ViewActionState) => {
      setPending(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      const board = boards.find((b) => b.id === boardId);
      setCreated((prev) => [
        { title: value, board: board?.name ?? "" },
        ...prev,
      ]);
      setTitle("");
      inputRef.current?.focus();
    });
  }

  if (boards.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No boards yet</p>
          <p>Create a board on the Board view before adding tasks here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.fastEntry}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Add Tasks Quickly</h1>
          <p className={styles.subtitle}>
            Type a task and press Enter. The next one is ready right away.
          </p>
        </div>

        <div className={styles.fastRow}>
          <select
            className={styles.fastBoardSelect}
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            aria-label="Target board"
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            className={styles.fastInput}
            value={title}
            placeholder="Task name, then Enter…"
            disabled={pending}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>

        {error && <p className={styles.errorText}>{error}</p>}

        {created.length > 0 && (
          <>
            <p className={styles.fastHint}>
              Created this session ({created.length})
            </p>
            <div className={styles.fastCreated}>
              {created.map((c, i) => (
                <div key={i} className={styles.fastCreatedItem}>
                  <span className={styles.fastCreatedTick} aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 8.5l3 3 7-7"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span>{c.title}</span>
                  <span className={styles.fastHint}>· {c.board}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
