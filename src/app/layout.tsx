import type { Metadata } from "next";
import "../styles/tokens.css";
import "../styles/globals.css";
import AppShell from "@/components/AppShell";
import { auth } from "@/auth";
import { currentActor } from "@/lib/scope";
import { countUnread } from "@/lib/notificationsData";

export const metadata: Metadata = {
  title: "Halevora Tasks",
  description: "The Halevora team's task board.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const user = session?.user
    ? { name: session.user.name ?? "", role: session.user.role }
    : null;

  // The actor's id + initial unread count seed the header inbox bell (live thereafter over SSE).
  const actor = await currentActor();
  const unread = actor ? await countUnread(actor) : 0;

  return (
    <html lang="en">
      <body>
        <AppShell user={user} userId={actor?.userId ?? null} initialUnread={unread}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
