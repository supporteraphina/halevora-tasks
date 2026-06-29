import type { Metadata } from "next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { currentActor } from "@/lib/scope";
import UsersAdmin from "./UsersAdmin";
import styles from "./admin.module.css";

export const metadata: Metadata = {
  title: "Users — Halevora Tasks",
};

export default async function AdminUsersPage() {
  // Server-side role gate. Middleware only checks "signed in"; CEO-only lives here.
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (actor.role !== "CEO") redirect("/board");

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, timezone: true },
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Team members</h1>
        <p className={styles.subtitle}>
          Add people, rename them, set their role, or reset a password. Only a CEO
          can manage the team.
        </p>
      </header>
      <UsersAdmin users={users} currentUserId={actor.userId} />
    </div>
  );
}
