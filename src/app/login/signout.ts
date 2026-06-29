"use server";

import { signOut } from "@/auth";

/** Sign the current user out and return them to the login page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
