import type { Metadata } from "next";
import TaskDetailView from "../TaskDetailView";

export const metadata: Metadata = {
  title: "Task — Halevora Tasks",
};

// Always reflect the latest data (every detail mutation revalidates this path).
export const dynamic = "force-dynamic";

/**
 * Full-page task detail (deep link / hard navigation). The intercepted @modal route
 * renders the same panel over the board for in-app navigation; this page handles a
 * direct visit or refresh.
 */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetailView taskId={id} />;
}
