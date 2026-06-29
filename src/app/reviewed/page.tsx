import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadScopedTasks, loadFilterOptions } from "@/app/views/data";
import { loadSavedViews, loadSavedView } from "@/app/views/savedViews";
import ListView from "@/app/views/ListView";

export const metadata: Metadata = {
  title: "Reviewed — Halevora Tasks",
};

export const dynamic = "force-dynamic";

export default async function ReviewedPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  // SCOPED read: loadScopedTasks composes taskWhereForCurrentUser(); onlyReviewed narrows to
  // the REVIEWED tasks that leave the board grid. A MEMBER still sees only their own.
  const [tasks, options, savedViews] = await Promise.all([
    loadScopedTasks({ onlyReviewed: true }),
    loadFilterOptions(),
    loadSavedViews(),
  ]);

  const { view: viewId } = await searchParams;
  const activeView = viewId ? await loadSavedView(viewId) : null;

  return (
    <ListView
      title="Reviewed"
      subtitle="Tasks marked Reviewed have left the board and live here."
      kind="reviewed"
      tasks={tasks}
      timezone={actor.timezone}
      options={options}
      savedViews={savedViews}
      activeView={activeView}
      groupByBoard
      canSaveAll={actor.role === "CEO"}
    />
  );
}
