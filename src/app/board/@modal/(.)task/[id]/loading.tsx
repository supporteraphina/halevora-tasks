import TaskPanelSkeleton from "../../../task/TaskPanelSkeleton";

// Shown INSTANTLY when a card is clicked, while the intercepted task detail loads on the
// server — so the open feels immediate instead of hanging on a blank click.
export default function Loading() {
  return <TaskPanelSkeleton />;
}
