import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { currentActor } from "@/lib/scope";
import { loadAutomationPage } from "../data";
import AutomationManager from "./AutomationManager";
import styles from "./automation.module.css";

export const metadata: Metadata = {
  title: "Automations — Halevora Tasks",
};

// Rule writes revalidate this path; always reflect the latest.
export const dynamic = "force-dynamic";

export default async function AutomationPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  // Server-side role gate. CEO only — a MEMBER is redirected, never shown this surface.
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (actor.role !== "CEO") redirect("/board");

  const { boardId } = await params;
  const data = await loadAutomationPage(boardId);
  if (!data) notFound();

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/board" className={styles.crumbLink}>
          Board
        </Link>
        <span className={styles.crumbSep} aria-hidden="true">
          /
        </span>
        <span className={styles.crumbCurrent}>{data.board.name}</span>
        <span className={styles.crumbSep} aria-hidden="true">
          /
        </span>
        <span className={styles.crumbCurrent}>Automations</span>
      </nav>

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Automations</h1>
          <p className={styles.subtitle}>
            Build rules that run when something happens on{" "}
            <strong>{data.board.name}</strong>. A rule watches for a trigger, checks your
            conditions, then runs its actions. Only a CEO can manage automations.
          </p>
        </div>
      </header>

      <AutomationManager
        boardId={data.board.id}
        boardName={data.board.name}
        rules={data.rules}
        users={data.users}
        tags={data.tags}
      />
    </div>
  );
}
