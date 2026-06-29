/**
 * Task templates — pure, framework-free blueprint (de)serialization + materialise plan.
 *
 * A `TaskTemplate.data` Json column stores a TASK BLUEPRINT: the shape of a task to spawn
 * (title, description, priority, time estimate, checklists, custom-field defaults, one level
 * of subtasks). This module is the single source of truth for what a valid blueprint is.
 *
 * The blueprint JSON is UNTRUSTED on read (a row could be hand-edited or stale across a
 * schema change), so `parseBlueprint` is DEFENSIVE — it never throws, drops anything
 * unrecognized, and bounds the size of nested lists. This mirrors `parseViewConfig` in
 * src/domain/views.ts. The server action persists `serializeBlueprint(...)` and materialises
 * with `materializePlan(parseBlueprint(...))`; keeping it pure means it is exhaustively
 * unit-tested once and the action stays thin.
 *
 * Custom-field VALUES are captured verbatim from the source task and re-applied by id mapping
 * (field name + type) on the target board in the action — the blueprint stores the raw value
 * JSON, which the action re-validates with `parseFieldValue` before persisting (a stored value
 * is never trusted into the DB without re-parsing against the destination field's config).
 */

import { type Priority, PRIORITIES } from "./priority";
import { CUSTOM_FIELD_TYPES, type CustomFieldKind } from "./customFields";

const MAX_TITLE = 500;
const MAX_CHECKLIST_NAME = 120;
const MAX_ITEM = 500;
const MAX_CHECKLISTS = 50;
const MAX_ITEMS = 100;
const MAX_SUBTASKS = 100;
const MAX_FIELDS = 50;

/** One checklist item in a blueprint. `done` is captured but reset on materialise. */
export interface BlueprintChecklistItem {
  content: string;
  done: boolean;
}

/** A checklist (name + ordered items) in a blueprint. */
export interface BlueprintChecklist {
  name: string;
  items: BlueprintChecklistItem[];
}

/** A custom-field default: by field NAME + TYPE so it can re-bind on the target board. */
export interface BlueprintCustomField {
  name: string;
  type: CustomFieldKind;
  value: unknown; // raw value JSON; re-validated against the destination field on apply
}

/** A subtask blueprint — one level only (never carries its own subtasks). */
export interface BlueprintSubtask {
  title: string;
  priority: Priority;
  checklists: BlueprintChecklist[];
}

/** The full task blueprint stored in `TaskTemplate.data`. */
export interface TaskBlueprint {
  title: string;
  description?: unknown; // Tiptap document JSON, or omitted
  priority: Priority;
  timeEstimate?: number; // minutes, or omitted
  checklists: BlueprintChecklist[];
  customFields: BlueprintCustomField[];
  subtasks: BlueprintSubtask[];
}

// --- Snapshot -> blueprint (save-as-template) --------------------------------

/** What the server reads off a source task to build a blueprint. */
export interface TaskSnapshot {
  title: string;
  description: unknown; // Tiptap document JSON, or null
  priority: Priority;
  timeEstimate: number | null;
  checklists: { name: string; items: { content: string; done: boolean }[] }[];
  customFields: { name: string; type: string; value: unknown }[];
  subtasks: {
    title: string;
    priority: Priority;
    checklists: { name: string; items: { content: string; done: boolean }[] }[];
  }[];
}

function snapshotChecklists(
  lists: { name: string; items: { content: string; done: boolean }[] }[],
): BlueprintChecklist[] {
  return lists.map((c) => ({
    name: c.name,
    items: c.items.map((i) => ({ content: i.content, done: i.done })),
  }));
}

/** Build a blueprint from a source-task snapshot. Pure; the action gathers the snapshot. */
export function serializeBlueprint(snap: TaskSnapshot): TaskBlueprint {
  const bp: TaskBlueprint = {
    title: snap.title,
    priority: snap.priority,
    checklists: snapshotChecklists(snap.checklists),
    customFields: snap.customFields
      .filter((f) => isFieldKind(f.type))
      .map((f) => ({ name: f.name, type: f.type as CustomFieldKind, value: f.value })),
    subtasks: snap.subtasks.map((s) => ({
      title: s.title,
      priority: s.priority,
      checklists: snapshotChecklists(s.checklists),
    })),
  };
  if (snap.description != null) bp.description = snap.description;
  if (snap.timeEstimate != null) bp.timeEstimate = snap.timeEstimate;
  return bp;
}

// --- Untrusted JSON -> blueprint (defensive parse) ---------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function isFieldKind(v: unknown): v is CustomFieldKind {
  return typeof v === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(v);
}

function parsePriority(v: unknown): Priority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v)
    ? (v as Priority)
    : "NORMAL";
}

function parseTitle(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  if (t.length === 0) return fallback;
  return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE) : t;
}

function parseChecklists(v: unknown): BlueprintChecklist[] {
  if (!Array.isArray(v)) return [];
  const out: BlueprintChecklist[] = [];
  for (const raw of v.slice(0, MAX_CHECKLISTS)) {
    const rec = asRecord(raw);
    // A non-object checklist entry (e.g. "nope") is dropped entirely.
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name =
      typeof rec.name === "string" && rec.name.trim().length > 0
        ? rec.name.trim().slice(0, MAX_CHECKLIST_NAME)
        : "Checklist";
    const items: BlueprintChecklistItem[] = [];
    if (Array.isArray(rec.items)) {
      for (const it of rec.items.slice(0, MAX_ITEMS)) {
        const irec = asRecord(it);
        if (typeof irec.content !== "string") continue;
        const content = irec.content.trim();
        if (content.length === 0) continue;
        items.push({
          content: content.slice(0, MAX_ITEM),
          done: irec.done === true,
        });
      }
    }
    out.push({ name, items });
  }
  return out;
}

function parseCustomFields(v: unknown): BlueprintCustomField[] {
  if (!Array.isArray(v)) return [];
  const out: BlueprintCustomField[] = [];
  for (const raw of v.slice(0, MAX_FIELDS)) {
    const rec = asRecord(raw);
    if (!isFieldKind(rec.type)) continue;
    if (typeof rec.name !== "string" || rec.name.trim().length === 0) continue;
    out.push({ name: rec.name.trim(), type: rec.type, value: rec.value ?? null });
  }
  return out;
}

function parseSubtasks(v: unknown): BlueprintSubtask[] {
  if (!Array.isArray(v)) return [];
  const out: BlueprintSubtask[] = [];
  for (const raw of v.slice(0, MAX_SUBTASKS)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = asRecord(raw);
    out.push({
      title: parseTitle(rec.title, "Untitled subtask"),
      priority: parsePriority(rec.priority),
      // One level only: a subtask blueprint never carries its own subtasks.
      checklists: parseChecklists(rec.checklists),
    });
  }
  return out;
}

/**
 * Parse an untrusted `TaskTemplate.data` value into a valid blueprint. NEVER throws:
 * anything unrecognized is dropped, nested lists are size-capped, and required fields fall
 * back to safe defaults. The result is always materialisable.
 */
export function parseBlueprint(input: unknown): TaskBlueprint {
  const rec = asRecord(input);
  const bp: TaskBlueprint = {
    title: parseTitle(rec.title, "Untitled task"),
    priority: parsePriority(rec.priority),
    checklists: parseChecklists(rec.checklists),
    customFields: parseCustomFields(rec.customFields),
    subtasks: parseSubtasks(rec.subtasks),
  };
  // Description: keep any object (Tiptap doc); drop primitives/arrays/null.
  if (rec.description != null && typeof rec.description === "object") {
    bp.description = rec.description;
  }
  if (typeof rec.timeEstimate === "number" && Number.isFinite(rec.timeEstimate)) {
    const m = Math.trunc(rec.timeEstimate);
    if (m >= 0) bp.timeEstimate = m;
  }
  return bp;
}

// --- Blueprint -> create plan (create-from-template) -------------------------

export interface PlanChecklist {
  name: string;
  items: { content: string; done: boolean }[];
}

export interface PlanCustomField {
  name: string;
  type: CustomFieldKind;
  value: unknown;
}

export interface PlanSubtask {
  title: string;
  priority: Priority;
  checklists: PlanChecklist[];
}

/** A pure description of everything the action must CREATE for one materialise. */
export interface MaterializePlan {
  title: string;
  description?: unknown;
  priority: Priority;
  timeEstimate?: number;
  checklists: PlanChecklist[];
  customFields: PlanCustomField[];
  subtasks: PlanSubtask[];
}

/** Materialise items as not-done: a freshly spawned task starts with nothing checked off. */
function planChecklists(lists: BlueprintChecklist[]): PlanChecklist[] {
  return lists.map((c) => ({
    name: c.name,
    items: c.items.map((i) => ({ content: i.content, done: false })),
  }));
}

/**
 * Turn a (already parsed) blueprint into a create plan. The action walks the plan to issue
 * the Prisma creates (task -> checklists/items -> custom-field values -> subtasks). Pure:
 * no ids, no DB — only the intended content. Items are reset to not-done.
 */
export function materializePlan(bp: TaskBlueprint): MaterializePlan {
  const plan: MaterializePlan = {
    title: bp.title,
    priority: bp.priority,
    checklists: planChecklists(bp.checklists),
    customFields: bp.customFields.map((f) => ({
      name: f.name,
      type: f.type,
      value: f.value,
    })),
    subtasks: bp.subtasks.map((s) => ({
      title: s.title,
      priority: s.priority,
      checklists: planChecklists(s.checklists),
    })),
  };
  if (bp.description !== undefined) plan.description = bp.description;
  if (bp.timeEstimate !== undefined) plan.timeEstimate = bp.timeEstimate;
  return plan;
}
