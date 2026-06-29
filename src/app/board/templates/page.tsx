import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadTemplates, loadTemplateBoardOptions } from "./data";
import TemplatesManager from "./TemplatesManager";

export const metadata: Metadata = {
  title: "Templates — Halevora Tasks",
};

// Template list + apply reflect the latest data (save/delete revalidate this path).
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  const [templates, boards] = await Promise.all([
    loadTemplates(),
    loadTemplateBoardOptions(),
  ]);

  return (
    <TemplatesManager
      templates={templates}
      boards={boards}
      currentUserId={actor.userId}
      isCeo={actor.role === "CEO"}
    />
  );
}
