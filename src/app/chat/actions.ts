"use server";

import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { visibleBoardIds } from "@/lib/realtimeScope";
import { publishChatEvent } from "@/lib/realtime";
import { notifyOnChatMessage } from "@/lib/notifications";
import { loadBoardMessages, loadMessage, type ChatMessageView } from "./data";

export interface ChatActionState {
  error?: string;
  ok?: boolean;
}

const MAX_CHAT_LEN = 4000;

/**
 * Post a chat message to a board. Authorized SERVER-SIDE: the actor must be able to see the
 * board (the documented chat-visibility rule) — a member cannot post into a board they have no
 * task visibility into, even with a guessed boardId. On success we NOTIFY the board channel
 * (ids only — the message body is NOT broadcast; each subscriber re-fetches it under scope).
 */
export async function sendChatMessageAction(
  _prev: ChatActionState,
  formData: FormData,
): Promise<ChatActionState> {
  const actor = await requireActor();
  const boardId = String(formData.get("boardId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!boardId) return { error: "Missing board." };
  if (body.length === 0) return { error: "Write a message first." };
  if (body.length > MAX_CHAT_LEN) return { error: "That message is too long." };

  // Board-visibility re-auth: never trust the client boardId.
  const allowed = await visibleBoardIds(actor);
  if (!allowed.has(boardId)) return { error: "That board is not available." };

  const msg = await prisma.chatMessage.create({
    data: { boardId, authorId: actor.userId, body },
    select: { id: true, board: { select: { name: true } } },
  });

  // Live-deliver: announce the new message id on the board channel (body stays off the wire).
  await publishChatEvent(boardId, msg.id);
  // Notify @mentioned users (best-effort; never blocks). A mention notifies but grants no
  // board access — opening the inbox link respects the same board-visibility scope as chat.
  await notifyOnChatMessage({
    actorId: actor.userId,
    boardId,
    body,
    boardName: msg.board.name,
  });
  return { ok: true };
}

/** Fetch the recent messages for a board (the client calls this to (re)hydrate on open). */
export async function fetchBoardMessagesAction(
  boardId: string,
): Promise<{ messages?: ChatMessageView[]; error?: string }> {
  const actor = await requireActor();
  if (!boardId) return { error: "Missing board." };
  const messages = await loadBoardMessages(actor, boardId);
  return { messages };
}

/** Fetch one message by id (the SSE patch path — append a single newly-arrived message). */
export async function fetchMessageAction(
  messageId: string,
): Promise<{ message?: ChatMessageView; error?: string }> {
  const actor = await requireActor();
  if (!messageId) return { error: "Missing message." };
  const message = await loadMessage(actor, messageId);
  if (!message) return { error: "Not found." };
  return { message };
}
