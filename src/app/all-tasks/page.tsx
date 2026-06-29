import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadScopedTasks, loadFilterOptions } from "@/app/views/data";
import { loadSavedViews, loadSavedView } from "@/app/views/savedViews";
import ListView from "@/app/views/ListView";

export const metadata: Metadata = {
  title: "All Tasks — Halevora Tasks",
};

export const dynamic = "force-dynamic";

export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // Server-side role gate. CEO only — a MEMBER is redirected, never shown every task.
  // (Same gate idiom as src/app/board/automation/[boardId]/page.tsx:24.)
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (actor.role !== "CEO") redirect("/my-tasks");

  // SCOPED read: loadScopedTasks still composes taskWhereForCurrentUser(); for a CEO the
  // scope fragment is {} (all tasks), so the page shows every board's tasks. A MEMBER never
  // reaches this read — they were redirected above.
  const [tasks, options, savedViews] = await Promise.all([
    loadScopedTasks(),
    loadFilterOptions(),
    loadSavedViews(),
  ]);

  const { view: viewId } = await searchParams;
  const activeView = viewId ? await loadSavedView(viewId) : null;

  return (
    <ListView
      title="All Tasks (CEO View)"
      subtitle="Every task across all boards."
      kind="all"
      tasks={tasks}
      timezone={actor.timezone}
      options={options}
      savedViews={savedViews}
      activeView={activeView}
      groupByBoard
      canSaveAll
    />
  );
}
