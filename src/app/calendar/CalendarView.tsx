"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  dayKey,
  monthGrid,
  weekGrid,
  periodLabel,
  stepAnchor,
  type CalDay,
  type CalendarMode,
} from "@/domain/calendar";
import { badgeFor, type BadgeKey } from "@/domain/statusGroups";
import type { Status, Priority } from "@prisma/client";
import { rescheduleTaskAction, type ViewActionState } from "@/app/views/actions";
import styles from "./calendar.module.css";

export interface CalendarTask {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueAt: Date;
  dueKey: string; // YYYY-MM-DD in the actor's timezone
  boardName: string;
  boardColor: string | null;
}

const BADGE_VARS: Record<BadgeKey, string> = {
  TODO: "todo",
  IN_PROGRESS: "progress",
  DONE: "done",
  REVIEWED: "reviewed",
  OVERDUE: "overdue",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarView({
  tasks,
  today,
  timezone: _timezone,
}: {
  tasks: CalendarTask[];
  today: CalDay;
  timezone: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<CalDay>(today);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const now = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);

  // Bucket tasks by their local due-day key for O(1) cell lookup.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const t of tasks) {
      const arr = map.get(t.dueKey);
      if (arr) arr.push(t);
      else map.set(t.dueKey, [t]);
    }
    return map;
  }, [tasks]);

  function reschedule(taskId: string, key: string) {
    setPending(true);
    const fd = new FormData();
    fd.set("taskId", taskId);
    fd.set("date", key);
    // Delegates to setDateAction, which re-authorizes the task via findVisibleTask before
    // writing — the dragged id is never trusted.
    rescheduleTaskAction({}, fd).then((res: ViewActionState) => {
      setPending(false);
      setDragId(null);
      setDropKey(null);
      if (!res.error) router.refresh();
    });
  }

  function onDropDay(key: string) {
    if (dragId) reschedule(dragId, key);
  }

  const cells =
    mode === "day"
      ? [{ day: anchor, inMonth: true }]
      : mode === "week"
        ? weekGrid(anchor).map((day) => ({ day, inMonth: true }))
        : monthGrid(anchor);

  return (
    <div className={styles.page} data-pending={pending || undefined}>
      <header className={styles.toolbar}>
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setAnchor(stepAnchor(anchor, mode, -1))}
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            className={styles.todayBtn}
            onClick={() => setAnchor(today)}
          >
            Today
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setAnchor(stepAnchor(anchor, mode, 1))}
            aria-label="Next"
          >
            ›
          </button>
          <h1 className={styles.period}>{periodLabel(anchor, mode)}</h1>
        </div>

        <div className={styles.modes} role="tablist" aria-label="Calendar mode">
          {(["month", "week", "day"] as CalendarMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={styles.modeBtn}
              data-active={mode === m}
              onClick={() => setMode(m)}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {mode !== "day" && (
        <div className={styles.weekHeader} data-week={mode === "week" || undefined}>
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className={styles.weekHeaderCell}>
              {w}
            </div>
          ))}
        </div>
      )}

      <div
        className={styles.grid}
        data-mode={mode}
      >
        {cells.map(({ day, inMonth }) => {
          const key = dayKey(day);
          const dayTasks = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={styles.cell}
              data-outside={!inMonth || undefined}
              data-today={key === todayKey || undefined}
              data-drop={dropKey === key || undefined}
              data-day={mode === "day" || undefined}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setDropKey(key);
              }}
              onDragLeave={() => {
                setDropKey((cur) => (cur === key ? null : cur));
              }}
              onDrop={(e) => {
                if (!dragId) return;
                e.preventDefault();
                onDropDay(key);
              }}
            >
              <div className={styles.cellHead}>
                <span className={styles.cellDate} data-today={key === todayKey || undefined}>
                  {day.day}
                </span>
                {dayTasks.length > 0 && (
                  <span className={styles.cellCount}>{dayTasks.length}</span>
                )}
              </div>
              <div className={styles.cellTasks}>
                {dayTasks.map((t) => {
                  const badge = badgeFor(t, now);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={styles.event}
                      data-tone={BADGE_VARS[badge.key]}
                      data-dragging={dragId === t.id || undefined}
                      draggable
                      title={`${t.title} — ${t.boardName}`}
                      onClick={() => router.push(`/board/task/${t.id}`)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropKey(null);
                      }}
                    >
                      <span
                        className={styles.eventDot}
                        data-tone={BADGE_VARS[badge.key]}
                        aria-hidden="true"
                      />
                      <span className={styles.eventTitle}>{t.title}</span>
                    </button>
                  );
                })}
                {dayTasks.length === 0 && mode === "day" && (
                  <p className={styles.dayEmpty}>Nothing due this day.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className={styles.hint}>
        Drag a task onto another day to reschedule its due date.
      </p>
    </div>
  );
}
