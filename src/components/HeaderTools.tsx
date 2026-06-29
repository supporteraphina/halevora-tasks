"use client";

/**
 * Header tools: a global SEARCH trigger (command-palette overlay) + a NOTIFICATIONS bell with
 * an inbox panel. Both live in the top nav (AppShell). The bell badge updates LIVE: this
 * component subscribes to the SSE stream and re-fetches the inbox on a `notification` event for
 * THIS user (the server only forwards a user's own notification pings).
 *
 * Scope: the inbox actions are recipient-scoped server-side; search is actor-scoped server-side.
 * This client never re-decides authorization — it renders what the scoped actions return.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/useRealtime";
import {
  fetchInboxAction,
  markReadAction,
  markAllReadAction,
  type InboxSnapshot,
} from "@/app/inbox/actions";
import { searchAction, type SearchResult } from "@/app/search/actions";
import type { NotificationView } from "@/lib/notificationsData";
import type { RealtimeEvent } from "@/domain/realtime";
import styles from "./HeaderTools.module.css";

const STATUS_LABEL: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  REVIEWED: "Reviewed",
};

export default function HeaderTools({
  userId,
  initialUnread,
}: {
  userId: string;
  initialUnread: number;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);

  const apply = useCallback((snap: InboxSnapshot) => {
    setNotifications(snap.notifications);
    setUnread(snap.unread);
  }, []);

  // LIVE inbox: subscribe to the stream (no board ids needed — the server always wires this
  // user's own notification channel). On a `notification` ping for us, re-fetch the inbox.
  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (event.type !== "notification") return;
      if (event.recipientId && event.recipientId !== userId) return;
      fetchInboxAction().then(apply);
    },
    [userId, apply],
  );
  useRealtime([], onEvent, true);

  // Refresh the inbox whenever the panel opens (catches anything missed while the panel was shut).
  useEffect(() => {
    if (inboxOpen) fetchInboxAction().then(apply);
  }, [inboxOpen, apply]);

  // Cmd/Ctrl+K opens search; Escape closes whatever is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setInboxOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.tools}>
      <button
        type="button"
        className={styles.toolBtn}
        aria-label="Search tasks"
        title="Search (Ctrl K)"
        onClick={() => setSearchOpen(true)}
      >
        <SearchIcon />
      </button>

      <div className={styles.bellWrap}>
        <button
          type="button"
          className={styles.toolBtn}
          aria-label={
            unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
          }
          aria-haspopup="dialog"
          aria-expanded={inboxOpen}
          title="Notifications"
          onClick={() => setInboxOpen((v) => !v)}
        >
          <BellIcon />
          {unread > 0 ? (
            <span className={styles.badge} aria-hidden="true">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
        {inboxOpen ? (
          <InboxPanel
            notifications={notifications}
            unread={unread}
            onApply={apply}
            onClose={() => setInboxOpen(false)}
          />
        ) : null}
      </div>

      {searchOpen ? <SearchOverlay onClose={() => setSearchOpen(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Inbox panel
// ---------------------------------------------------------------------------

function InboxPanel({
  notifications,
  unread,
  onApply,
  onClose,
}: {
  notifications: NotificationView[];
  unread: number;
  onApply: (snap: InboxSnapshot) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  // Close on outside click / Escape.
  useEffect(() => {
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
  }, [onClose]);

  function open(n: NotificationView) {
    startTransition(async () => {
      const snap = await markReadAction(n.id);
      onApply(snap);
    });
    onClose();
    // The link respects scope: if the recipient can't see the task, the detail page 404s.
    if (n.taskId) router.push(`/board/task/${n.taskId}`);
    else if (n.boardId) router.push("/chat");
  }

  return (
    <div className={styles.panel} role="dialog" aria-label="Notifications" ref={ref}>
      <header className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Notifications</h2>
        {unread > 0 ? (
          <button
            type="button"
            className={styles.markAll}
            onClick={() =>
              startTransition(async () => onApply(await markAllReadAction()))
            }
          >
            Mark all read
          </button>
        ) : null}
      </header>
      <ul className={styles.list}>
        {notifications.length === 0 ? (
          <li className={styles.empty}>
            <BellIcon />
            <span>You&rsquo;re all caught up.</span>
          </li>
        ) : (
          notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={styles.item}
                data-unread={n.readAt === null || undefined}
                onClick={() => open(n)}
              >
                <span className={styles.dot} data-on={n.readAt === null || undefined} aria-hidden="true" />
                <span className={styles.itemBody}>
                  <span className={styles.itemText}>{describe(n)}</span>
                  <time className={styles.itemTime}>{relativeTime(new Date(n.createdAt))}</time>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function describe(n: NotificationView): string {
  const who = n.actorName ?? "Someone";
  const what = n.taskTitle ?? n.boardName ?? "a task";
  switch (n.type) {
    case "assigned":
      return `${who} assigned you to "${what}"`;
    case "mentioned":
      return n.taskTitle
        ? `${who} mentioned you on "${what}"`
        : `${who} mentioned you in ${what} chat`;
    case "commented":
      return `${who} commented on "${what}"`;
    default:
      return `${who} sent you a notification`;
  }
}

// ---------------------------------------------------------------------------
//  Search overlay (command palette)
// ---------------------------------------------------------------------------

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, startSearch] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced scoped search.
  useEffect(() => {
    const handle = setTimeout(() => {
      startSearch(async () => {
        const res = await searchAction(query);
        setResults(res.results);
        setSearched(res.query.length >= 2);
        setActive(0);
      });
    }, 180);
    return () => clearTimeout(handle);
  }, [query]);

  function go(r: SearchResult) {
    onClose();
    router.push(`/board/task/${r.id}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  }

  return (
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        className={styles.search}
        role="dialog"
        aria-label="Search tasks"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.searchInputRow}>
          <SearchIcon />
          <input
            ref={inputRef}
            className={styles.searchInput}
            value={query}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>
        <div className={styles.searchResults} role="listbox" aria-label="Results">
          {searching ? (
            <p className={styles.searchHint}>Searching…</p>
          ) : !searched ? (
            <p className={styles.searchHint}>Type at least 2 characters.</p>
          ) : results.length === 0 ? (
            <p className={styles.searchHint}>No tasks match “{query}”.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className={styles.searchResult}
                data-active={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
              >
                <span className={styles.searchResultTitle}>{r.title}</span>
                <span className={styles.searchResultMeta}>
                  <span className={styles.searchBoard}>{r.boardName}</span>
                  <span className={styles.searchStatus}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Time + icons
// ---------------------------------------------------------------------------

function relativeTime(d: Date): string {
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.8a3.6 3.6 0 00-3.6 3.6c0 4-1.4 5-1.4 5h10s-1.4-1-1.4-5A3.6 3.6 0 008 1.8z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M6.6 13a1.5 1.5 0 002.8 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
