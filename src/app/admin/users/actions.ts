"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { requireRole } from "@/lib/scope";
import { isRole, validateNewUser } from "@/domain/users";

export interface AdminState {
  error?: string;
  ok?: string;
}

const ADMIN_PATH = "/admin/users";

/** Create a new team member (CEO only). */
export async function createUserAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireRole("CEO");

  const parsed = validateNewUser({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.ok) return { error: parsed.error };

  const existing = await prisma.user.findUnique({
    where: { email: parsed.value.email },
  });
  if (existing) return { error: "A user with that email already exists." };

  const passwordHash = await bcrypt.hash(parsed.value.password, 10);
  await prisma.user.create({
    data: {
      name: parsed.value.name,
      email: parsed.value.email,
      role: parsed.value.role,
      passwordHash,
    },
  });

  revalidatePath(ADMIN_PATH);
  return { ok: `Added ${parsed.value.name}.` };
}

/** Rename a user (CEO only). */
export async function renameUserAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return { error: "Missing user." };
  if (name.length === 0) return { error: "Name is required." };

  await prisma.user.update({ where: { id }, data: { name } });
  revalidatePath(ADMIN_PATH);
  return { ok: "Name updated." };
}

/** Change a user's role (CEO only). Guarded so the last CEO can't be demoted. */
export async function setRoleAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const actor = await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!id) return { error: "Missing user." };
  if (!isRole(role)) return { error: "Role must be CEO or MEMBER." };

  // Don't let the workspace end up with zero CEOs (you can't demote the last one).
  if (role === "MEMBER") {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === "CEO") {
      const ceoCount = await prisma.user.count({ where: { role: "CEO" } });
      if (ceoCount <= 1) {
        return { error: "Cannot demote the only CEO." };
      }
    }
  }

  await prisma.user.update({ where: { id }, data: { role } });
  revalidatePath(ADMIN_PATH);
  return { ok: id === actor.userId ? "Your role was updated." : "Role updated." };
}

/** Reset a user's password (CEO only). */
export async function resetPasswordAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  await requireRole("CEO");

  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!id) return { error: "Missing user." };
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  revalidatePath(ADMIN_PATH);
  return { ok: "Password reset." };
}
