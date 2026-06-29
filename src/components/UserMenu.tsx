import Link from "next/link";
import { signOutAction } from "@/app/login/signout";
import styles from "./UserMenu.module.css";

/**
 * Signed-in user chip: name, role badge, a CEO-only Admin link, and sign-out.
 * Rendered inside the client AppShell; sign-out posts to a "use server" action.
 */
export default function UserMenu({ name, role }: { name: string; role: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={styles.menu}>
      {role === "CEO" ? (
        <Link href="/admin/users" className={styles.adminLink}>
          Admin
        </Link>
      ) : null}
      <span className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
        <span className={styles.meta}>
          <span className={styles.name}>{name}</span>
          <span className={styles.role}>{role === "CEO" ? "CEO" : "Member"}</span>
        </span>
      </span>
      <form action={signOutAction}>
        <button type="submit" className={styles.signOut}>
          Sign out
        </button>
      </form>
    </div>
  );
}
