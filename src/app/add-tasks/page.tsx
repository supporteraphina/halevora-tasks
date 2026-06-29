import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/scope";
import { loadBoardOptions } from "@/app/views/data";
import FastEntry from "./FastEntry";

export const metadata: Metadata = {
  title: "Add Tasks Quickly — Halevora Tasks",
};

export const dynamic = "force-dynamic";

export default async function AddTasksPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");

  // Boards are reference data for the target picker; the CREATE is authorized server-side
  // (createTaskAction verifies the board and auto-assigns the creator so they can see it).
  const boards = await loadBoardOptions();

  return <FastEntry boards={boards} />;
}
