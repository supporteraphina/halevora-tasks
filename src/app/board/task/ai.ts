"use server";

import Anthropic from "@anthropic-ai/sdk";
import prisma from "@/lib/prisma";
import { requireActor } from "@/lib/scope";
import { taskScopeWhere } from "@/domain/scope";

/**
 * AI-assist for the task description (Section 4). Drafts or expands a task description
 * with Claude. SERVER-ONLY: the API key never reaches the client.
 *
 * Degrades gracefully: if ANTHROPIC_API_KEY is absent (the default in this repo), the
 * action returns `{ enabled: false }` with a clear message instead of crashing. The
 * client uses `enabled` to disable the button and surface the message.
 *
 * Model id `claude-opus-4-8` with adaptive thinking — confirmed via the `claude-api`
 * skill (do not hardcode a model id from memory; the skill is the source of truth).
 */

export interface AiAssistResult {
  enabled: boolean;
  text?: string;
  error?: string;
}

/** True when AI assist can run — i.e. the key is configured. Read by the UI to enable the button. */
export async function aiAssistAvailable(): Promise<boolean> {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Draft or expand a task description. `taskId` is re-authorized against the actor's scope
 * (a client id is untrusted); `instruction` is the optional user prompt. Returns plain
 * text the client inserts into the Tiptap editor.
 */
export async function aiAssistDescription(
  taskId: string,
  instruction: string,
): Promise<AiAssistResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      enabled: false,
      error: "Set ANTHROPIC_API_KEY to enable AI assist.",
    };
  }

  // Re-authorize: the actor must be able to see this task (scoped read), and we pull the
  // title as grounding context. A foreign/invisible id yields null -> "Task not found."
  const actor = await requireActor();
  const task = await prisma.task.findFirst({
    where: { AND: [taskScopeWhere(actor), { id: taskId, archivedAt: null }] },
    select: { title: true },
  });
  if (!task) return { enabled: true, error: "Task not found." };

  const ask = instruction.trim();
  const prompt = ask.length
    ? `Task title: "${task.title}".\n\nThe user asks: ${ask}\n\nWrite a clear, concise task description that addresses this. Plain prose, no markdown headers, no preamble.`
    : `Write a clear, concise description for a task titled "${task.title}". Cover the goal and a short checklist of what "done" looks like. Plain prose, no markdown headers, no preamble.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system:
        "You are a concise project-management writing assistant. You draft task descriptions for a Kanban tool. Write in plain, direct prose. No em dashes. No preamble like 'Here is'. Return only the description text.",
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) return { enabled: true, error: "No suggestion was generated." };
    return { enabled: true, text };
  } catch {
    // Never leak provider internals; never crash the panel.
    return { enabled: true, error: "AI assist is temporarily unavailable." };
  }
}
