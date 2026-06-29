import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadBoard } from "./data";
import { loadFilterOptions } from "@/app/views/data";
import Board from "./Board";
import styles from "./board.module.css";

export const metadata: Metadata = {
  title: "Board — Halevora Tasks",
};

// Always reflect the latest data (drag/move/status writes revalidate this path).
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  const [board, options] = await Promise.all([loadBoard(), loadFilterOptions()]);

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <span className={styles.crumb}>Team Space</span>
        <span className={styles.crumbSep} aria-hidden="true">
          /
        </span>
        <span className={styles.crumbCurrent}>{board.workspaceName}</span>
        <Link href="/board/templates" className={styles.templatesLink}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2.5 2.5h7l2 2v7h-9z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path d="M4.5 2.5v3h4v-3M4.5 11.5v-3h5v3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Templates
        </Link>
      </nav>

      <div className={styles.body}>
        <aside className={styles.rail} aria-label="Projects">
          <p className={styles.railHeading}>Projects</p>
          <ul className={styles.railList}>
            {board.projects.map((p) => (
              <li
                key={p.id}
                className={styles.railItem}
                data-active={p.name === board.projectName || undefined}
              >
                <span className={styles.railIcon} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect
                      x="1.5"
                      y="2.5"
                      width="11"
                      height="9"
                      rx="1.5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                    <path
                      d="M1.5 5.5h11"
                      stroke="currentColor"
                      strokeWidth="1.2"
                    />
                  </svg>
                </span>
                {p.name}
              </li>
            ))}
          </ul>
        </aside>

        <Board
          columns={board.columns}
          isCeo={actor.role === "CEO"}
          users={options.users}
          tags={options.tags}
        />
      </div>
    </div>
  );
}
