import { notFound, redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadTaskDetail, loadPickerData } from "./data";
import { aiAssistAvailable } from "./ai";
import TaskPanelClient from "./TaskPanelClient";

/**
 * Server component shared by the intercepted modal route and the full-page route.
 * Loads the SCOPED task detail (a client id is untrusted — an invisible/foreign id 404s),
 * the picker data, and whether AI assist is available, then renders the client panel.
 */
export default async function TaskDetailView({
  taskId,
  intercepted = false,
}: {
  taskId: string;
  /** True when rendered by the @modal intercept route (close pops history to reset the slot). */
  intercepted?: boolean;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  const task = await loadTaskDetail(taskId);
  if (!task) notFound(); // invisible or non-existent — same response, no existence leak.

  const [picker, aiEnabled] = await Promise.all([
    loadPickerData(),
    aiAssistAvailable(),
  ]);

  return (
    <TaskPanelClient
      task={task}
      picker={picker}
      timezone={actor.timezone}
      currentUserId={actor.userId}
      isCeo={actor.role === "CEO"}
      aiEnabled={aiEnabled}
      intercepted={intercepted}
    />
  );
}
