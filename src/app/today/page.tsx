import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadScopedTasks, loadFilterOptions } from "@/app/views/data";
import { loadSavedViews, loadSavedView } from "@/app/views/savedViews";
import { isSameDayInZone } from "@/domain/dates";
import { isOverdue } from "@/domain/status";
import ListView from "@/app/views/ListView";

export const metadata: Metadata = {
  title: "Today — Halevora Tasks",
};

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  // SCOPED read: composes taskWhereForCurrentUser() inside loadScopedTasks.
  const [tasks, options, savedViews] = await Promise.all([
    loadScopedTasks(),
    loadFilterOptions(),
    loadSavedViews(),
  ]);

  // "Today" is DERIVED in the actor's timezone — a task counts if it is due on the actor's
  // local calendar day OR is still-open overdue (carried forward, like ClickUp's TODAY view).
  // Never bucketed in server-UTC.
  const now = new Date();
  const today = tasks.filter((t) => {
    if (t.dueAt === null) return false;
    if (isSameDayInZone(t.dueAt, now, actor.timezone)) return true;
    return isOverdue({ status: t.status, dueAt: t.dueAt }, now);
  });

  const { view: viewId } = await searchParams;
  const activeView = viewId ? await loadSavedView(viewId) : null;

  return (
    <ListView
      title="All Tasks TODAY"
      subtitle="Due today (your timezone), plus anything overdue."
      kind="today"
      tasks={today}
      timezone={actor.timezone}
      options={options}
      savedViews={savedViews}
      activeView={activeView}
      groupByBoard
      canSaveAll={actor.role === "CEO"}
    />
  );
}
