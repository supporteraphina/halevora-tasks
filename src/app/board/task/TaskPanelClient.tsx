"use client";

import { useRouter } from "next/navigation";
import TaskPanel from "./TaskPanel";
import type { TaskDetail, PickerData } from "./data";

/**
 * Client wrapper that gives TaskPanel an `onClose`.
 *
 * The two routes close differently:
 *  - Intercepted @modal route (clicked a card): `router.back()` pops the intercepted
 *    segment so the @modal slot resets to its default and the overlay actually closes.
 *    A `push("/board")` here leaves the slot active, so the panel stays on screen.
 *  - Full-page route (deep link / refresh): there's no modal slot to pop, so navigate
 *    to `/board`.
 */
export default function TaskPanelClient({
  task,
  picker,
  timezone,
  currentUserId,
  isCeo,
  aiEnabled,
  intercepted = false,
}: {
  task: TaskDetail;
  picker: PickerData;
  timezone: string;
  currentUserId: string;
  isCeo: boolean;
  aiEnabled: boolean;
  intercepted?: boolean;
}) {
  const router = useRouter();
  const onClose = () => {
    if (intercepted) router.back();
    else router.push("/board");
  };
  return (
    <TaskPanel
      task={task}
      picker={picker}
      timezone={timezone}
      currentUserId={currentUserId}
      isCeo={isCeo}
      aiEnabled={aiEnabled}
      onClose={onClose}
    />
  );
}
