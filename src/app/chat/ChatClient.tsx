"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRealtime } from "@/components/useRealtime";
import MentionText from "@/components/MentionText";
import {
  sendChatMessageAction,
  fetchBoardMessagesAction,
  fetchMessageAction,
} from "./actions";
import type { ChatBoard, ChatMessageView } from "./data";
import type { RealtimeEvent } from "@/domain/realtime";
import styles from "./chat.module.css";

export interface MentionUser {
  id: string;
  name: string;
  handle: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(d);
}

export default function ChatClient({
  boards,
  initialBoardId,
  initialMessages,
  currentUserId,
  timezone,
  mentionUsers,
  handles,
}: {
  boards: ChatBoard[];
  initialBoardId: string | null;
  initialMessages: ChatMessageView[];
  currentUserId: string;
  timezone: string;
  mentionUsers: MentionUser[];
  handles: string[];
}) {
  const [activeBoardId, setActiveBoardId] = useState<string | null>(initialBoardId);
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Lowercased resolvable handle set for chip highlighting (stable for the session).
  const handleSet = useMemo(() => new Set(handles.map((h) => h.toLowerCase())), [handles]);

  // @mention autocomplete: when the caret is typing a `@token`, suggest matching users.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionUsers
      .filter((u) => u.handle.toLowerCase().startsWith(q) || u.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, mentionUsers]);

  function onDraftChange(value: string) {
    setDraft(value);
    // Detect a trailing `@token` the caret is inside (token = word chars after the last @).
    const m = /(^|\s)@([a-z0-9._-]*)$/i.exec(value);
    setMentionQuery(m ? m[2] : null);
  }

  function pickMention(u: MentionUser) {
    const next = draft.replace(/(^|\s)@([a-z0-9._-]*)$/i, (_full, lead) => `${lead}@${u.handle} `);
    setDraft(next);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;

  // Subscribe to the active board only. Memoize the id array so we reconnect just on change.
  const subscribedBoards = useMemo(
    () => (activeBoardId ? [activeBoardId] : []),
    [activeBoardId],
  );

  // Append a single message by id when a chat event arrives for the active board. Dedupe by id.
  function onEvent(event: RealtimeEvent) {
    if (event.type !== "chat") return;
    if (!event.messageId || event.boardId !== activeBoardId) return;
    const messageId = event.messageId;
    fetchMessageAction(messageId).then((res) => {
      if (!res.message) return;
      setMessages((prev) =>
        prev.some((m) => m.id === res.message!.id) ? prev : [...prev, res.message!],
      );
    });
  }

  const { presentUserIds, connected } = useRealtime(subscribedBoards, onEvent);

  // When the active board changes, (re)load its history.
  useEffect(() => {
    if (!activeBoardId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    fetchBoardMessagesAction(activeBoardId).then((res) => {
      if (cancelled) return;
      if (res.messages) setMessages(res.messages);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBoardId]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send() {
    const body = draft.trim();
    if (!body || !activeBoardId) return;
    setError(null);
    const fd = new FormData();
    fd.set("boardId", activeBoardId);
    fd.set("body", body);
    startTransition(async () => {
      const res = await sendChatMessageAction({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDraft("");
      setMentionQuery(null);
      // Optimistic refresh: the SSE event will append, but re-fetch ensures our own message
      // appears even if the local stream missed its own broadcast.
      const refreshed = await fetchBoardMessagesAction(activeBoardId);
      if (refreshed.messages) setMessages(refreshed.messages);
    });
  }

  // Other viewers present (exclude self).
  const others = presentUserIds.filter((id) => id !== currentUserId);

  if (boards.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <h1 className={styles.emptyTitle}>No boards yet</h1>
          <p className={styles.emptyNote}>
            Board chat appears once you have tasks on a board you can see.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar} aria-label="Board chats">
        <p className={styles.sidebarHeading}>Boards</p>
        <ul className={styles.boardList}>
          {boards.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className={styles.boardItem}
                data-active={b.id === activeBoardId || undefined}
                onClick={() => setActiveBoardId(b.id)}
              >
                <span
                  className={styles.boardDot}
                  style={{ background: b.color ?? "var(--ink-subtle)" }}
                  aria-hidden="true"
                />
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className={styles.panel} aria-label="Chat">
        <header className={styles.panelHeader}>
          <div className={styles.panelTitleRow}>
            <h1 className={styles.panelTitle}>{activeBoard?.name ?? "Chat"}</h1>
            <span
              className={styles.presence}
              title={connected ? "Live" : "Reconnecting…"}
            >
              <span
                className={styles.presenceDot}
                data-on={connected || undefined}
                aria-hidden="true"
              />
              {others.length > 0
                ? `${others.length} other${others.length === 1 ? "" : "s"} viewing`
                : connected
                  ? "Only you"
                  : "Offline"}
            </span>
          </div>
        </header>

        <div className={styles.messages} ref={listRef}>
          {messages.length === 0 ? (
            <p className={styles.noMessages}>
              No messages yet. Say hello to the {activeBoard?.name} team.
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.authorId === currentUserId;
              return (
                <div
                  key={m.id}
                  className={styles.message}
                  data-mine={mine || undefined}
                >
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(m.authorName)}
                  </span>
                  <div className={styles.bubble}>
                    <div className={styles.bubbleMeta}>
                      <span className={styles.author}>{m.authorName}</span>
                      <time className={styles.time}>
                        {formatTime(new Date(m.createdAt), timezone)}
                      </time>
                    </div>
                    <p className={styles.body}>
                      <MentionText text={m.body} handles={handleSet} />
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.composer}>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.composerRow}>
            {suggestions.length > 0 ? (
              <ul className={styles.mentionMenu} role="listbox" aria-label="Mention a teammate">
                {suggestions.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className={styles.mentionOption}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMention(u);
                      }}
                    >
                      <span className={styles.mentionName}>{u.name}</span>
                      <span className={styles.mentionHandle}>@{u.handle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <textarea
              ref={textareaRef}
              className={styles.input}
              value={draft}
              placeholder={`Message ${activeBoard?.name ?? ""} — @ to mention`}
              rows={1}
              disabled={pending || !activeBoardId}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && mentionQuery !== null) {
                  setMentionQuery(null);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && suggestions.length === 0) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              type="button"
              className={styles.send}
              disabled={pending || !draft.trim() || !activeBoardId}
              onClick={send}
            >
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
