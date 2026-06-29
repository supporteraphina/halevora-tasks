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
  // `intercepted` => close pops history (router.back) so the @modal slot resets and the
  // overlay actually closes; a push to /board would leave the panel on screen.
  return <TaskDetailView taskId={id} intercepted />;
}
