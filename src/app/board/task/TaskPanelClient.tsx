"use client";

import { useRouter } from "next/navigation";
import TaskPanel from "./TaskPanel";
import type { TaskDetail, PickerData } from "./data";

/**
 * Client wrapper that gives TaskPanel an `onClose` that returns to the board.
 * Used by both the intercepted modal route and the full-page route — closing always
 * navigates back to /board (router.back() would also work for the modal, but a push
 * keeps deep-link loads working identically).
 */
export default function TaskPanelClient({
  task,
  picker,
  timezone,
  currentUserId,
  aiEnabled,
}: {
  task: TaskDetail;
  picker: PickerData;
  timezone: string;
  currentUserId: string;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  return (
    <TaskPanel
      task={task}
      picker={picker}
      timezone={timezone}
      currentUserId={currentUserId}
      aiEnabled={aiEnabled}
      onClose={() => router.push("/board")}
    />
  );
}
