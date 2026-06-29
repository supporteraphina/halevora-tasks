import type { Metadata } from "next";
import "../styles/tokens.css";
import "../styles/globals.css";
import AppShell from "@/components/AppShell";
import { auth } from "@/auth";

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

  return (
    <html lang="en">
      <body>
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
