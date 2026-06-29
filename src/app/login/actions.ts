"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { normalizeEmail } from "@/domain/users";

export interface LoginState {
  error?: string;
}

/**
 * Server action for the credentials login form. On success Auth.js throws a redirect
 * to /board which must propagate (so we only catch AuthError). A bad credential pair
 * surfaces a single generic message — never reveal which half was wrong.
 */
export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  try {
    await signIn("credentials", {
      email: normalizeEmail(email),
      password,
      redirectTo: "/board",
    });
    return {};
  } catch (err) {
    // CredentialsSignin (and other AuthErrors) => generic message.
    if (err instanceof AuthError) {
      return { error: "Wrong email or password." };
    }
    // Anything else (notably the success-redirect) must propagate.
    throw err;
  }
}
