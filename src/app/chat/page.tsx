import type { Metadata } from "next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { currentActor } from "@/lib/scope";
import { candidateHandles } from "@/domain/mentions";
import { loadChatBoards, loadBoardMessages } from "./data";
import ChatClient from "./ChatClient";

export const metadata: Metadata = {
  title: "Chat — Halevora Tasks",
};

// Chat is realtime; never cache the shell.
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  const boards = await loadChatBoards(actor);
  // Pre-load the first visible board's messages so the panel isn't empty on first paint.
  const firstBoardId = boards[0]?.id ?? null;
  const initialMessages = firstBoardId
    ? await loadBoardMessages(actor, firstBoardId)
    : [];

  // Mention candidates: name + email handles, for the @mention picker + chip highlight. Names
  // are not row-scoped task content (any member may mention anyone; visibility is unchanged).
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const mentionUsers = users.map((u) => ({
    id: u.id,
    name: u.name,
    handle: candidateHandles(u)[0] ?? u.id,
  }));
  const handles = users.flatMap((u) => candidateHandles(u));

  return (
    <ChatClient
      boards={boards}
      initialBoardId={firstBoardId}
      initialMessages={initialMessages}
      currentUserId={actor.userId}
      timezone={actor.timezone}
      mentionUsers={mentionUsers}
      handles={handles}
    />
  );
}
