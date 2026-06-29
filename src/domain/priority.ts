/**
 * Task priority. Pure, framework-free domain logic.
 * Mirror of the Prisma `Priority` enum — keep identical.
 */

export type Priority = "URGENT" | "HIGH" | "NORMAL" | "LOW";

/** Most urgent first. */
export const PRIORITIES: Priority[] = ["URGENT", "HIGH", "NORMAL", "LOW"];

/** Lower rank = more urgent. Useful as a stable sort key. */
export function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

/** Array sort comparator placing the most urgent priority first. */
export function comparePriority(a: Priority, b: Priority): number {
  return priorityRank(a) - priorityRank(b);
}
