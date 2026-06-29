"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";
import UserMenu from "./UserMenu";
import HeaderTools from "./HeaderTools";

interface Tab {
  href: string;
  label: string;
  ceoOnly?: boolean;
}

// Order mirrors the ClickUp tab row in the source screenshots. "All Tasks (CEO View)" is
// CEO-only here and is also server-gated on its page — hiding the tab is just UX, not the
// security boundary.
const TABS: Tab[] = [
  { href: "/board", label: "Board" },
  { href: "/my-tasks", label: "My Tasks" },
  { href: "/add-tasks", label: "Add Tasks Quickly" },
  { href: "/all-tasks", label: "All Tasks (CEO View)", ceoOnly: true },
  { href: "/today", label: "All Tasks TODAY" },
  { href: "/reviewed", label: "Reviewed" },
  { href: "/calendar", label: "Calendar" },
  { href: "/chat", label: "Chat" },
];

export default function AppShell({
  children,
  user,
  userId,
  initialUnread,
}: {
  children: React.ReactNode;
  user?: { name: string; role: string } | null;
  userId?: string | null;
  initialUnread?: number;
}) {
  const pathname = usePathname();

  // Auth routes (login) render without the app chrome.
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return <>{children}</>;
  }

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
          {TABS.filter((tab) => !tab.ceoOnly || user?.role === "CEO").map((tab) => {
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
        <div className={styles.right}>
          {user && userId ? (
            <HeaderTools userId={userId} initialUnread={initialUnread ?? 0} />
          ) : null}
          {user ? <UserMenu name={user.name} role={user.role} /> : null}
        </div>
      </header>
      <main className={styles.main}>
        <div key={pathname} className={styles.view}>
          {children}
        </div>
      </main>
    </div>
  );
}
