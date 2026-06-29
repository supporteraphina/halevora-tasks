import TaskDetailView from "../../../task/TaskDetailView";

// Intercepted route: clicking a card on /board opens the detail panel HERE, over the
// board, without a full navigation. The panel itself is an overlay (see panel.module.css).
export const dynamic = "force-dynamic";

export default async function InterceptedTaskModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetailView taskId={id} />;
}
