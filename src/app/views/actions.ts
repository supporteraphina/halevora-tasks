"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { parseFilter, parseSort } from "@/domain/views";
import { isViewKind } from "./savedViews";
import { appendOrder } from "@/domain/ordering";
import { createTaskAction } from "@/app/board/actions";
import { setDateAction } from "@/app/board/task/actions";

export interface ViewActionState {
  error?: string;
  ok?: boolean;
  /** The new saved view's id, returned so the client can navigate to it. */
  viewId?: string;
}

const VIEW_PATHS = [
  "/my-tasks",
  "/all-tasks",
  "/today",
  "/reviewed",
  "/calendar",
  "/add-tasks",
];

function revalidateViews() {
  for (const p of VIEW_PATHS) revalidatePath(p);
}

/**
 * Save a custom view for the current actor. The config (filter + sort) is parsed defensively
 * before storage, so a malformed client payload never persists garbage. Owner = the actor;
 * a saved view is always private to its creator.
 */
export async function createSavedViewAction(
  _prev: ViewActionState,
  formData: FormData,
): Promise<ViewActionState> {
  const actor = await requireActor();
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "my_tasks");
  if (name.length === 0) return { error: "Name your view first." };
  if (name.length > 80) return { error: "That name is too long." };
  if (!isViewKind(kind)) return { error: "Unknown view type." };

  // The "all" (All-CEO) kind may only be saved by a CEO — it is a CEO-only base scope.
  if (kind === "all" && actor.role !== "CEO") {
    return { error: "Only a CEO can save an All Tasks view." };
  }

  let filterRaw: unknown = {};
  let sortRaw: unknown = [];
  try {
    filterRaw = JSON.parse(String(formData.get("filter") ?? "{}"));
    sortRaw = JSON.parse(String(formData.get("sort") ?? "[]"));
  } catch {
    return { error: "Could not read the view configuration." };
  }
  const config = { filter: parseFilter(filterRaw), sort: parseSort(sortRaw) };

  const max = await prisma.savedView.aggregate({
    where: { ownerId: actor.userId },
    _max: { order: true },
  });

  const view = await prisma.savedView.create({
    data: {
      ownerId: actor.userId,
      name,
      kind,
      // config is a plain { filter, sort } object; cast to Prisma's JSON input type.
      config: config as unknown as Prisma.InputJsonValue,
      order: appendOrder(max._max.order),
    },
    select: { id: true },
  });

  revalidateViews();
  return { ok: true, viewId: view.id };
}

/** Rename a saved view the actor owns. */
export async function renameSavedViewAction(
  _prev: ViewActionState,
  formData: FormData,
): Promise<ViewActionState> {
  const actor = await requireActor();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return { error: "Missing view." };
  if (name.length === 0) return { error: "Name your view first." };
  if (name.length > 80) return { error: "That name is too long." };

  // Owner-scoped update: only the owner's row matches, so this can never touch another's view.
  const res = await prisma.savedView.updateMany({
    where: { id, ownerId: actor.userId },
    data: { name },
  });
  if (res.count === 0) return { error: "View not found." };
  revalidateViews();
  return { ok: true };
}

/** Delete a saved view the actor owns. */
export async function deleteSavedViewAction(
  _prev: ViewActionState,
  formData: FormData,
): Promise<ViewActionState> {
  const actor = await requireActor();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing view." };

  const res = await prisma.savedView.deleteMany({
    where: { id, ownerId: actor.userId },
  });
  if (res.count === 0) return { error: "View not found." };
  revalidateViews();
  return { ok: true };
}

/**
 * Reschedule a task's DUE date by dragging it onto a calendar day. This does NOT add a second
 * date mutation — it delegates to the existing `setDateAction` (src/app/board/task/actions.ts),
 * which re-authorizes the task via `findVisibleTask` (scope re-check; the dragged id is never
 * trusted) and stores local-midnight-as-UTC in the actor's timezone. We accept a YYYY-MM-DD
 * day from the drop target and forward it as a `mode: "date"` set.
 */
export async function rescheduleTaskAction(
  _prev: ViewActionState,
  formData: FormData,
): Promise<ViewActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!taskId) return { error: "Missing task." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Bad date." };

  const fd = new FormData();
  fd.set("taskId", taskId);
  fd.set("field", "due");
  fd.set("mode", "date");
  fd.set("date", date);
  // setDateAction re-authorizes via findVisibleTask and revalidates /board + the task page.
  const result = await setDateAction({}, fd);
  if (result.error) return { error: result.error };

  revalidateViews();
  return { ok: true };
}

/**
 * Fast-entry: create one task into a chosen board, then the client keeps focus for the next.
 * Delegates to the board's `createTaskAction`, which authorizes the board exists and assigns
 * the creator (so a MEMBER can see what they just made). Returns ok so the composer can clear
 * and stay open. Scoping is on READ; any signed-in user may create.
 */
export async function quickCreateTaskAction(
  _prev: ViewActionState,
  formData: FormData,
): Promise<ViewActionState> {
  const result = await createTaskAction({}, formData);
  if (result.error) return { error: result.error };
  revalidateViews();
  return { ok: true };
}
