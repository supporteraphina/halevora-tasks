import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
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

  return (
    <ChatClient
      boards={boards}
      initialBoardId={firstBoardId}
      initialMessages={initialMessages}
      currentUserId={actor.userId}
      timezone={actor.timezone}
    />
  );
}
