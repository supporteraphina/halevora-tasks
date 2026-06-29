"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

const TABS = [
  { href: "/board", label: "Board" },
  { href: "/my-tasks", label: "My Tasks" },
  { href: "/calendar", label: "Calendar" },
  { href: "/chat", label: "Chat" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <header className={styles.nav}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="3" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="8" y="3" width="4" height="9" rx="1" fill="currentColor" opacity="0.7" />
              <rect x="14" y="3" width="4" height="11" rx="1" fill="currentColor" opacity="0.45" />
            </svg>
          </span>
          <span className={styles.wordmark}>Halevora Tasks</span>
        </div>
        <nav className={styles.tabs} aria-label="Primary">
          {TABS.map((tab) => {
            const active =
              pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={styles.tab}
                data-active={active}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
