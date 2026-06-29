import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadScopedTasks } from "@/app/views/data";
import { dateInputValue } from "@/domain/dates";
import type { CalDay } from "@/domain/calendar";
import CalendarView, { type CalendarTask } from "./CalendarView";

export const metadata: Metadata = {
  title: "Calendar — Halevora Tasks",
};

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  // SCOPED read: loadScopedTasks composes taskWhereForCurrentUser(); hasDueOnly keeps only
  // tasks with a due date (the calendar places by due date). A MEMBER sees only their own.
  const rows = await loadScopedTasks({ hasDueOnly: true });

  // Project each task's due date to its LOCAL day key in the actor's timezone, so it lands on
  // the right calendar cell regardless of the stored UTC instant.
  const tasks: CalendarTask[] = rows
    .filter((t) => t.dueAt !== null)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt as Date,
      dueKey: dateInputValue(t.dueAt as Date, actor.timezone),
      boardName: t.boardName,
      boardColor: t.boardColor,
    }));

  // The actor's local "today", as a calendar day — for highlighting and the default anchor.
  const todayStr = dateInputValue(new Date(), actor.timezone);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const today: CalDay = { year: ty, month: tm, day: td };

  return <CalendarView tasks={tasks} today={today} timezone={actor.timezone} />;
}
