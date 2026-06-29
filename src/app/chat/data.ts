/**
 * Per-board chat data loader. Server-only.
 *
 * Chat is per board. A user may see a board's chat iff they can see that board (the documented
 * rule, handoff 11 §security): CEO sees all boards; a MEMBER sees only boards where they are
 * assigned to >=1 non-archived task. We resolve the actor's visible board set via
 * `visibleBoardIds` (src/lib/realtimeScope.ts) — the SAME predicate the SSE relay uses to
 * authorize chat events — so the page list, the SSE subscription, and event delivery agree.
 *
 * Message bodies are loaded ONLY for boards in that visible set. A member can never read chat
 * history for a board they have no task visibility into, even by guessing a board id.
 */
import prisma from "@/lib/prisma";
import type { SessionActor } from "@/lib/scope";
import { visibleBoardIds } from "@/lib/realtimeScope";

export interface ChatBoard {
  id: string;
  name: string;
  color: string | null;
}

export interface ChatMessageView {
  id: string;
  boardId: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: Date;
}

/** The boards whose chat this actor may open, in board order. */
export async function loadChatBoards(actor: SessionActor): Promise<ChatBoard[]> {
  const allowed = await visibleBoardIds(actor);
  if (allowed.size === 0) return [];
  const boards = await prisma.board.findMany({
    where: { id: { in: [...allowed] }, archivedAt: null },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });
  return boards;
}

/**
 * Load the recent messages for ONE board, newest-last. Re-checks board visibility for the
 * actor before reading — never trust the boardId from the client. Returns [] for a board the
 * actor may not see (never leak existence). The `take` is a recent window; chat is not paged in v1.
 */
export async function loadBoardMessages(
  actor: SessionActor,
  boardId: string,
  limit = 100,
): Promise<ChatMessageView[]> {
  const allowed = await visibleBoardIds(actor);
  if (!allowed.has(boardId)) return [];

  const rows = await prisma.chatMessage.findMany({
    where: { boardId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      boardId: true,
      authorId: true,
      body: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });

  // Reverse to newest-last for natural chat reading order.
  return rows.reverse().map((r) => ({
    id: r.id,
    boardId: r.boardId,
    authorId: r.authorId,
    authorName: r.author?.name ?? "Unknown",
    body: r.body,
    createdAt: r.createdAt,
  }));
}

/** Load a single message (for the SSE patch path), scoped to the actor's board visibility. */
export async function loadMessage(
  actor: SessionActor,
  messageId: string,
): Promise<ChatMessageView | null> {
  const msg = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      boardId: true,
      authorId: true,
      body: true,
      createdAt: true,
      author: { select: { name: true } },
    },
  });
  if (!msg) return null;
  const allowed = await visibleBoardIds(actor);
  if (!allowed.has(msg.boardId)) return null; // never leak a message for a hidden board
  return {
    id: msg.id,
    boardId: msg.boardId,
    authorId: msg.authorId,
    authorName: msg.author?.name ?? "Unknown",
    body: msg.body,
    createdAt: msg.createdAt,
  };
}
