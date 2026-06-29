"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createRuleAction,
  updateRuleAction,
  deleteRuleAction,
  toggleRuleAction,
  reorderRuleAction,
  type AutomationActionState,
} from "../actions";
import {
  TRIGGER_TYPES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  ACTION_TYPES,
  type TriggerType,
  type ConditionField,
  type ConditionOperator,
  type ActionType,
} from "@/domain/automation";
import { STATUSES, type Status } from "@/domain/status";
import { PRIORITIES, type Priority } from "@/domain/priority";
import {
  TRIGGER_LABELS,
  FIELD_LABELS,
  OPERATOR_LABELS,
  ACTION_LABELS,
  STATUS_LABELS,
  PRIORITY_LABELS,
} from "@/domain/automationSummary";
import type { RuleListItem } from "../data";
import styles from "./automation.module.css";

interface Picker {
  users: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Local editor model — the in-progress rule shape the form edits before it is
// serialized to the engine's stored JSON (trigger / conditions / actions).
// ---------------------------------------------------------------------------

const CADENCES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"] as const;
type Cadence = (typeof CADENCES)[number];
const CADENCE_UNIT: Record<Cadence, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
  CUSTOM: "day",
};

interface DraftCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
}
interface DraftAction {
  type: ActionType;
  // One bag of optional params; only the field relevant to `type` is used at serialize time.
  status: Status;
  priority: Priority;
  userId: string;
  tag: string;
  text: string;
}
interface Draft {
  name: string;
  triggerType: TriggerType;
  triggerStatus: Status; // status_changed destination (empty sentinel via `triggerPinned`)
  triggerPriority: Priority; // priority_changed destination
  triggerPinned: boolean; // whether to narrow status/priority destination
  triggerTag: string; // tag_added pin
  cadence: Cadence; // scheduled
  interval: string; // scheduled
  matchMode: "all" | "any";
  conditions: DraftCondition[];
  actions: DraftAction[];
}

const OPERATORS_NEEDING_VALUE: ConditionOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "before",
  "after",
];
const DATE_FIELDS: ConditionField[] = ["dueAt", "startAt"];
const COLLECTION_FIELDS: ConditionField[] = ["tags", "assignees"];

function newCondition(): DraftCondition {
  return { field: "status", operator: "equals", value: "TODO" };
}
function newAction(): DraftAction {
  return {
    type: "set_status",
    status: "DONE",
    priority: "HIGH",
    userId: "",
    tag: "",
    text: "",
  };
}

function emptyDraft(): Draft {
  return {
    name: "",
    triggerType: "status_changed",
    triggerStatus: "DONE",
    triggerPriority: "URGENT",
    triggerPinned: true,
    triggerTag: "",
    cadence: "DAILY",
    interval: "1",
    matchMode: "all",
    conditions: [],
    actions: [newAction()],
  };
}

// ---------------------------------------------------------------------------
// Hydrate an existing stored rule back into a Draft for editing.
// ---------------------------------------------------------------------------

function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}
function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as string[]).includes(v);
}

function draftFromRule(rule: RuleListItem, users: Picker["users"]): Draft {
  const d = emptyDraft();
  d.name = rule.name;
  d.actions = [];

  const trig = rule.trigger as { type?: unknown; config?: Record<string, unknown> } | null;
  const config = (trig?.config ?? {}) as Record<string, unknown>;
  if (trig && typeof trig.type === "string" && (TRIGGER_TYPES as readonly string[]).includes(trig.type)) {
    d.triggerType = trig.type as TriggerType;
  }
  if (d.triggerType === "status_changed") {
    if (isStatus(config.to)) {
      d.triggerStatus = config.to;
      d.triggerPinned = true;
    } else {
      d.triggerPinned = false;
    }
  } else if (d.triggerType === "priority_changed") {
    if (isPriority(config.to)) {
      d.triggerPriority = config.to;
      d.triggerPinned = true;
    } else {
      d.triggerPinned = false;
    }
  } else if (d.triggerType === "tag_added") {
    d.triggerTag = typeof config.tag === "string" ? config.tag : "";
  } else if (d.triggerType === "scheduled") {
    const c = typeof config.cadence === "string" ? config.cadence : "DAILY";
    d.cadence = (CADENCES as readonly string[]).includes(c) ? (c as Cadence) : "DAILY";
    d.interval =
      typeof config.interval === "number" && config.interval >= 1
        ? String(Math.trunc(config.interval))
        : "1";
  }

  // Conditions: accept a flat array (AND) or a { match, conditions } group (AND/OR).
  let condArray: unknown[] = [];
  const rawConds = rule.conditions;
  if (Array.isArray(rawConds)) {
    condArray = rawConds;
    d.matchMode = "all";
  } else if (rawConds && typeof rawConds === "object" && Array.isArray((rawConds as { conditions?: unknown }).conditions)) {
    const group = rawConds as { match?: unknown; conditions: unknown[] };
    d.matchMode = group.match === "any" ? "any" : "all";
    condArray = group.conditions;
  }
  d.conditions = condArray
    .map((c): DraftCondition | null => {
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      const field = o.field;
      const operator = o.operator;
      if (typeof field !== "string" || !(CONDITION_FIELDS as readonly string[]).includes(field)) return null;
      if (typeof operator !== "string" || !(CONDITION_OPERATORS as readonly string[]).includes(operator)) return null;
      return {
        field: field as ConditionField,
        operator: operator as ConditionOperator,
        value: typeof o.value === "string" ? o.value : "",
      };
    })
    .filter((c): c is DraftCondition => c !== null);

  // Actions: re-hydrate each into the params bag.
  const rawActions = Array.isArray(rule.actions) ? rule.actions : [];
  d.actions = rawActions
    .map((a): DraftAction | null => {
      if (!a || typeof a !== "object") return null;
      const o = a as Record<string, unknown>;
      const type = o.type;
      if (typeof type !== "string" || !(ACTION_TYPES as readonly string[]).includes(type)) return null;
      const base = newAction();
      base.type = type as ActionType;
      if (isStatus(o.status)) base.status = o.status;
      if (isPriority(o.priority)) base.priority = o.priority;
      if (typeof o.userId === "string") base.userId = o.userId;
      if (typeof o.tag === "string") base.tag = o.tag;
      if (typeof o.text === "string") base.text = o.text;
      // Default a person action's userId to the first user so the select is never blank.
      if ((base.type === "assign_user" || base.type === "unassign_user") && !base.userId) {
        base.userId = users[0]?.id ?? "";
      }
      return base;
    })
    .filter((a): a is DraftAction => a !== null);
  if (d.actions.length === 0) d.actions = [newAction()];

  return d;
}

// ---------------------------------------------------------------------------
// Serialize a Draft into the engine's stored JSON parts.
// ---------------------------------------------------------------------------

function serializeTrigger(d: Draft): object {
  switch (d.triggerType) {
    case "status_changed":
      return { type: "status_changed", config: d.triggerPinned ? { to: d.triggerStatus } : {} };
    case "priority_changed":
      return {
        type: "priority_changed",
        config: d.triggerPinned ? { to: d.triggerPriority } : {},
      };
    case "tag_added":
      return {
        type: "tag_added",
        config: d.triggerTag.trim() ? { tag: d.triggerTag.trim() } : {},
      };
    case "scheduled":
      return {
        type: "scheduled",
        config: { cadence: d.cadence, interval: Math.max(1, Number(d.interval) || 1) },
      };
    default:
      return { type: d.triggerType, config: {} };
  }
}

function serializeConditions(d: Draft): unknown {
  const list = d.conditions.map((c) => {
    const base: Record<string, string> = { field: c.field, operator: c.operator };
    if (OPERATORS_NEEDING_VALUE.includes(c.operator)) base.value = c.value;
    return base;
  });
  // A flat array means implicit AND; wrap in a group only when the user picked OR.
  if (d.matchMode === "any" && list.length > 0) {
    return { match: "any", conditions: list };
  }
  return list;
}

function serializeActions(d: Draft): object[] {
  return d.actions.map((a) => {
    switch (a.type) {
      case "set_status":
        return { type: "set_status", status: a.status };
      case "set_priority":
        return { type: "set_priority", priority: a.priority };
      case "assign_user":
        return { type: "assign_user", userId: a.userId };
      case "unassign_user":
        return { type: "unassign_user", userId: a.userId };
      case "add_tag":
        return { type: "add_tag", tag: a.tag.trim() };
      case "remove_tag":
        return { type: "remove_tag", tag: a.tag.trim() };
      case "post_comment":
        return { type: "post_comment", text: a.text.trim() };
      default:
        return { type: a.type };
    }
  });
}

// ---------------------------------------------------------------------------
// Manager — the rule list + create/edit editor.
// ---------------------------------------------------------------------------

export default function AutomationManager({
  boardId,
  boardName,
  rules,
  users,
  tags,
}: {
  boardId: string;
  boardName: string;
  rules: RuleListItem[];
  users: Picker["users"];
  tags: Picker["tags"];
}) {
  // editorMode: null = list view; "new" = create; a rule id = editing that rule.
  const [editorMode, setEditorMode] = useState<null | "new" | string>(null);
  const picker: Picker = { users, tags };

  if (editorMode === "new") {
    return (
      <RuleEditor
        boardId={boardId}
        boardName={boardName}
        picker={picker}
        initial={emptyDraft()}
        existingId={null}
        onClose={() => setEditorMode(null)}
      />
    );
  }
  if (editorMode) {
    const rule = rules.find((r) => r.id === editorMode);
    if (rule) {
      return (
        <RuleEditor
          boardId={boardId}
          boardName={boardName}
          picker={picker}
          initial={draftFromRule(rule, users)}
          existingId={rule.id}
          onClose={() => setEditorMode(null)}
        />
      );
    }
  }

  return (
    <RuleList
      boardId={boardId}
      rules={rules}
      onCreate={() => setEditorMode("new")}
      onEdit={(id) => setEditorMode(id)}
    />
  );
}

// ---------------------------------------------------------------------------
// Rule list
// ---------------------------------------------------------------------------

function RuleList({
  boardId,
  rules,
  onCreate,
  onEdit,
}: {
  boardId: string;
  rules: RuleListItem[];
  onCreate: () => void;
  onEdit: (id: string) => void;
}) {
  return (
    <div className={styles.listWrap}>
      <div className={styles.listToolbar}>
        <span className={styles.ruleCount}>
          {rules.length} {rules.length === 1 ? "rule" : "rules"}
        </span>
        <button type="button" className={styles.primaryBtn} onClick={onCreate}>
          <PlusIcon /> New rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyMark} aria-hidden="true">
            <BoltIcon />
          </span>
          <h2 className={styles.emptyTitle}>No automations yet</h2>
          <p className={styles.emptyText}>
            Save yourself the busywork. A rule can move a task, set its priority, add a tag,
            or post a comment the moment something changes — no clicking required.
          </p>
          <button type="button" className={styles.primaryBtn} onClick={onCreate}>
            <PlusIcon /> Create your first rule
          </button>
        </div>
      ) : (
        <ol className={styles.ruleList}>
          {rules.map((rule, i) => (
            <RuleRow
              key={rule.id}
              boardId={boardId}
              rule={rule}
              isFirst={i === 0}
              isLast={i === rules.length - 1}
              onEdit={() => onEdit(rule.id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function RuleRow({
  boardId,
  rule,
  isFirst,
  isLast,
  onEdit,
}: {
  boardId: string;
  rule: RuleListItem;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(
    action: (s: AutomationActionState, fd: FormData) => Promise<AutomationActionState>,
    fields: Record<string, string>,
  ) {
    setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(async () => {
      const result = await action({}, fd);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <li className={styles.ruleRow} data-disabled={!rule.enabled || undefined}>
      <div className={styles.reorder}>
        <button
          type="button"
          className={styles.reorderBtn}
          disabled={pending || isFirst}
          aria-label={`Move ${rule.name} earlier`}
          onClick={() => run(reorderRuleAction, { id: rule.id, boardId, direction: "up" })}
        >
          <ChevronUp />
        </button>
        <button
          type="button"
          className={styles.reorderBtn}
          disabled={pending || isLast}
          aria-label={`Move ${rule.name} later`}
          onClick={() => run(reorderRuleAction, { id: rule.id, boardId, direction: "down" })}
        >
          <ChevronDown />
        </button>
      </div>

      <button type="button" className={styles.ruleMain} onClick={onEdit}>
        <span className={styles.ruleName}>
          {rule.name}
          {!rule.valid ? (
            <span className={styles.invalidPill} title="This rule can't run as stored">
              Needs attention
            </span>
          ) : null}
        </span>
        <span className={styles.ruleSummary}>
          <span className={styles.summaryWhen}>{rule.triggerSummary}</span>
          {rule.actionSummary ? (
            <>
              <ArrowRight />
              <span className={styles.summaryThen}>{rule.actionSummary}</span>
            </>
          ) : null}
        </span>
        {error ? (
          <span className={styles.rowError} role="alert">
            {error}
          </span>
        ) : null}
      </button>

      <div className={styles.ruleControls}>
        <label className={styles.toggle} title={rule.enabled ? "Enabled" : "Disabled"}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={rule.enabled}
            disabled={pending}
            aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
            onChange={(e) =>
              run(toggleRuleAction, {
                id: rule.id,
                boardId,
                enabled: e.target.checked ? "true" : "false",
              })
            }
          />
          <span className={styles.toggleTrack} aria-hidden="true">
            <span className={styles.toggleThumb} />
          </span>
        </label>

        <button
          type="button"
          className={styles.ghostBtn}
          disabled={pending}
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className={styles.dangerBtn}
          disabled={pending}
          aria-label={`Delete ${rule.name}`}
          onClick={() => {
            if (window.confirm(`Delete the rule "${rule.name}"? This can't be undone.`)) {
              run(deleteRuleAction, { id: rule.id, boardId });
            }
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Rule editor
// ---------------------------------------------------------------------------

function RuleEditor({
  boardId,
  boardName,
  picker,
  initial,
  existingId,
  onClose,
}: {
  boardId: string;
  boardName: string;
  picker: Picker;
  initial: Draft;
  existingId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("name", draft.name);
    fd.set("trigger", JSON.stringify(serializeTrigger(draft)));
    fd.set("conditions", JSON.stringify(serializeConditions(draft)));
    fd.set("actions", JSON.stringify(serializeActions(draft)));
    if (existingId) fd.set("id", existingId);

    startTransition(async () => {
      const action = existingId ? updateRuleAction : createRuleAction;
      const result = await action({}, fd);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <div className={styles.editor}>
      <div className={styles.editorHead}>
        <h2 className={styles.editorTitle}>
          {existingId ? "Edit rule" : "New rule"}
        </h2>
        <button type="button" className={styles.linkBtn} onClick={onClose}>
          Back to rules
        </button>
      </div>

      <label className={styles.nameField}>
        <span className={styles.fieldLabel}>Rule name</span>
        <input
          className={styles.textInput}
          value={draft.name}
          placeholder="e.g. Tag shipped work as Done"
          maxLength={120}
          disabled={pending}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>

      <TriggerStep draft={draft} patch={patch} picker={picker} pending={pending} />
      <ConditionStep draft={draft} setDraft={setDraft} picker={picker} pending={pending} />
      <ActionStep draft={draft} setDraft={setDraft} picker={picker} pending={pending} />

      {error ? (
        <p className={styles.editorError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={pending}
          onClick={save}
        >
          {pending ? "Saving…" : existingId ? "Save changes" : "Create rule"}
        </button>
      </div>
      <p className={styles.boardNote}>
        Runs on the <strong>{boardName}</strong> board.
      </p>
    </div>
  );
}

function StepHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className={styles.stepHead}>
      <span className={styles.stepNum} aria-hidden="true">
        {n}
      </span>
      <div>
        <h3 className={styles.stepTitle}>{title}</h3>
        <p className={styles.stepHint}>{hint}</p>
      </div>
    </div>
  );
}

// --- Step 1: Trigger ---

function TriggerStep({
  draft,
  patch,
  picker,
  pending,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  picker: Picker;
  pending: boolean;
}) {
  const t = draft.triggerType;
  return (
    <section className={styles.step}>
      <StepHeader n={1} title="When this happens" hint="The event that starts the rule." />
      <div className={styles.stepBody}>
        <label className={styles.inlineField}>
          <span className={styles.fieldLabel}>Trigger</span>
          <select
            className={styles.select}
            value={t}
            disabled={pending}
            aria-label="Trigger"
            onChange={(e) =>
              patch({ triggerType: e.target.value as TriggerType, triggerPinned: true })
            }
          >
            {TRIGGER_TYPES.map((tt) => (
              <option key={tt} value={tt}>
                {TRIGGER_LABELS[tt]}
              </option>
            ))}
          </select>
        </label>

        {(t === "status_changed" || t === "priority_changed") && (
          <div className={styles.triggerNarrow}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={draft.triggerPinned}
                disabled={pending}
                onChange={(e) => patch({ triggerPinned: e.target.checked })}
              />
              <span>Only when it changes to a specific value</span>
            </label>
            {draft.triggerPinned && t === "status_changed" ? (
              <label className={styles.inlineField}>
                <span className={styles.fieldLabel}>Status becomes</span>
                <select
                  className={styles.select}
                  value={draft.triggerStatus}
                  disabled={pending}
                  aria-label="Status destination"
                  onChange={(e) => patch({ triggerStatus: e.target.value as Status })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {draft.triggerPinned && t === "priority_changed" ? (
              <label className={styles.inlineField}>
                <span className={styles.fieldLabel}>Priority becomes</span>
                <select
                  className={styles.select}
                  value={draft.triggerPriority}
                  disabled={pending}
                  aria-label="Priority destination"
                  onChange={(e) => patch({ triggerPriority: e.target.value as Priority })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        )}

        {t === "tag_added" && (
          <label className={styles.inlineField}>
            <span className={styles.fieldLabel}>Tag (optional)</span>
            <input
              className={styles.textInput}
              value={draft.triggerTag}
              placeholder="Any tag, or name one"
              list="automation-tags"
              disabled={pending}
              aria-label="Tag that fires the rule"
              onChange={(e) => patch({ triggerTag: e.target.value })}
            />
          </label>
        )}

        {t === "scheduled" && (
          <div className={styles.scheduleRow}>
            <label className={styles.inlineField}>
              <span className={styles.fieldLabel}>Every</span>
              <input
                type="number"
                min={1}
                max={365}
                className={styles.numberInput}
                value={draft.interval}
                disabled={pending}
                aria-label="Interval"
                onChange={(e) => patch({ interval: e.target.value })}
              />
            </label>
            <label className={styles.inlineField}>
              <span className={styles.fieldLabel}>Period</span>
              <select
                className={styles.select}
                value={draft.cadence}
                disabled={pending}
                aria-label="Cadence"
                onChange={(e) => patch({ cadence: e.target.value as Cadence })}
              >
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {CADENCE_UNIT[c]}
                    {Number(draft.interval) === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {(t === "assignee_changed" || t === "due_changed") && (
          <p className={styles.triggerNote}>
            Runs whenever a task&apos;s {t === "assignee_changed" ? "assignee" : "due date"}{" "}
            changes on this board. Narrow it with conditions below.
          </p>
        )}

        <datalist id="automation-tags">
          {picker.tags.map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
      </div>
    </section>
  );
}

// --- Step 2: Conditions ---

function ConditionStep({
  draft,
  setDraft,
  picker,
  pending,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  picker: Picker;
  pending: boolean;
}) {
  function update(i: number, p: Partial<DraftCondition>) {
    setDraft((d) => {
      const conditions = d.conditions.map((c, idx) => (idx === i ? { ...c, ...p } : c));
      return { ...d, conditions };
    });
  }
  function add() {
    setDraft((d) => ({ ...d, conditions: [...d.conditions, newCondition()] }));
  }
  function remove(i: number) {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, idx) => idx !== i) }));
  }

  return (
    <section className={styles.step}>
      <StepHeader
        n={2}
        title="Only if"
        hint="Optional checks the task must pass. Leave empty to run every time."
      />
      <div className={styles.stepBody}>
        {draft.conditions.length > 1 ? (
          <div className={styles.matchMode} role="radiogroup" aria-label="Match mode">
            <span className={styles.fieldLabel}>Match</span>
            <label className={styles.radioPill} data-on={draft.matchMode === "all" || undefined}>
              <input
                type="radio"
                name="matchMode"
                checked={draft.matchMode === "all"}
                disabled={pending}
                onChange={() => setDraft((d) => ({ ...d, matchMode: "all" }))}
              />
              All (AND)
            </label>
            <label className={styles.radioPill} data-on={draft.matchMode === "any" || undefined}>
              <input
                type="radio"
                name="matchMode"
                checked={draft.matchMode === "any"}
                disabled={pending}
                onChange={() => setDraft((d) => ({ ...d, matchMode: "any" }))}
              />
              Any (OR)
            </label>
          </div>
        ) : null}

        {draft.conditions.length === 0 ? (
          <p className={styles.stepEmpty}>No conditions — the rule runs on every trigger.</p>
        ) : (
          <ul className={styles.rowList}>
            {draft.conditions.map((c, i) => (
              <li key={i} className={styles.conditionRow}>
                <select
                  className={styles.select}
                  value={c.field}
                  disabled={pending}
                  aria-label="Condition field"
                  onChange={(e) => {
                    const field = e.target.value as ConditionField;
                    // Reset the value to a sensible default for the new field type.
                    const value =
                      field === "status" ? "TODO" : field === "priority" ? "NORMAL" : "";
                    update(i, { field, value });
                  }}
                >
                  {CONDITION_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>

                <select
                  className={styles.select}
                  value={c.operator}
                  disabled={pending}
                  aria-label="Condition operator"
                  onChange={(e) => update(i, { operator: e.target.value as ConditionOperator })}
                >
                  {CONDITION_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </option>
                  ))}
                </select>

                <ConditionValue
                  condition={c}
                  picker={picker}
                  pending={pending}
                  onChange={(value) => update(i, { value })}
                />

                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={pending}
                  aria-label="Remove condition"
                  onClick={() => remove(i)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className={styles.addRowBtn} disabled={pending} onClick={add}>
          <PlusIcon /> Add condition
        </button>
      </div>
    </section>
  );
}

function ConditionValue({
  condition,
  picker,
  pending,
  onChange,
}: {
  condition: DraftCondition;
  picker: Picker;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const needsValue = OPERATORS_NEEDING_VALUE.includes(condition.operator);
  if (!needsValue) {
    return <span className={styles.valuePlaceholder} aria-hidden="true" />;
  }

  if (condition.field === "status") {
    return (
      <select
        className={styles.select}
        value={condition.value}
        disabled={pending}
        aria-label="Value"
        onChange={(e) => onChange(e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    );
  }
  if (condition.field === "priority") {
    return (
      <select
        className={styles.select}
        value={condition.value}
        disabled={pending}
        aria-label="Value"
        onChange={(e) => onChange(e.target.value)}
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
    );
  }
  if (condition.field === "assignees") {
    return (
      <select
        className={styles.select}
        value={condition.value}
        disabled={pending}
        aria-label="Value"
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a person…</option>
        {picker.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    );
  }
  if (DATE_FIELDS.includes(condition.field)) {
    return (
      <input
        type="date"
        className={styles.dateInput}
        value={condition.value}
        disabled={pending}
        aria-label="Value"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  // title, tags (free text — for tags, a tag name)
  return (
    <input
      className={styles.textInput}
      value={condition.value}
      placeholder={condition.field === "tags" ? "Tag name" : "Value"}
      list={condition.field === "tags" ? "automation-tags" : undefined}
      disabled={pending}
      aria-label="Value"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// --- Step 3: Actions ---

function ActionStep({
  draft,
  setDraft,
  picker,
  pending,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  picker: Picker;
  pending: boolean;
}) {
  function update(i: number, p: Partial<DraftAction>) {
    setDraft((d) => ({
      ...d,
      actions: d.actions.map((a, idx) => (idx === i ? { ...a, ...p } : a)),
    }));
  }
  function add() {
    const base = newAction();
    if (picker.users[0]) base.userId = picker.users[0].id;
    setDraft((d) => ({ ...d, actions: [...d.actions, base] }));
  }
  function remove(i: number) {
    setDraft((d) => ({ ...d, actions: d.actions.filter((_, idx) => idx !== i) }));
  }

  return (
    <section className={styles.step}>
      <StepHeader n={3} title="Then do this" hint="Actions run in order, top to bottom." />
      <div className={styles.stepBody}>
        <ol className={styles.rowList}>
          {draft.actions.map((a, i) => (
            <li key={i} className={styles.actionRow}>
              <span className={styles.actionOrder} aria-hidden="true">
                {i + 1}
              </span>
              <select
                className={styles.select}
                value={a.type}
                disabled={pending}
                aria-label="Action"
                onChange={(e) => {
                  const type = e.target.value as ActionType;
                  const p: Partial<DraftAction> = { type };
                  if (
                    (type === "assign_user" || type === "unassign_user") &&
                    !a.userId &&
                    picker.users[0]
                  ) {
                    p.userId = picker.users[0].id;
                  }
                  update(i, p);
                }}
              >
                {ACTION_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {ACTION_LABELS[at]}
                  </option>
                ))}
              </select>

              <ActionParam
                action={a}
                picker={picker}
                pending={pending}
                onChange={(p) => update(i, p)}
              />

              <button
                type="button"
                className={styles.removeBtn}
                disabled={pending || draft.actions.length === 1}
                aria-label="Remove action"
                title={draft.actions.length === 1 ? "A rule needs at least one action" : "Remove action"}
                onClick={() => remove(i)}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ol>

        <button type="button" className={styles.addRowBtn} disabled={pending} onClick={add}>
          <PlusIcon /> Add action
        </button>
      </div>
    </section>
  );
}

function ActionParam({
  action,
  picker,
  pending,
  onChange,
}: {
  action: DraftAction;
  picker: Picker;
  pending: boolean;
  onChange: (p: Partial<DraftAction>) => void;
}) {
  switch (action.type) {
    case "set_status":
      return (
        <select
          className={styles.select}
          value={action.status}
          disabled={pending}
          aria-label="Status"
          onChange={(e) => onChange({ status: e.target.value as Status })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      );
    case "set_priority":
      return (
        <select
          className={styles.select}
          value={action.priority}
          disabled={pending}
          aria-label="Priority"
          onChange={(e) => onChange({ priority: e.target.value as Priority })}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      );
    case "assign_user":
    case "unassign_user":
      return (
        <select
          className={styles.select}
          value={action.userId}
          disabled={pending}
          aria-label="Person"
          onChange={(e) => onChange({ userId: e.target.value })}
        >
          <option value="">Choose a person…</option>
          {picker.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      );
    case "add_tag":
    case "remove_tag":
      return (
        <input
          className={styles.textInput}
          value={action.tag}
          placeholder="Tag name"
          list="automation-tags"
          disabled={pending}
          aria-label="Tag"
          onChange={(e) => onChange({ tag: e.target.value })}
        />
      );
    case "post_comment":
      return (
        <input
          className={styles.textInput}
          value={action.text}
          placeholder="Comment text"
          maxLength={2000}
          disabled={pending}
          aria-label="Comment text"
          onChange={(e) => onChange({ text: e.target.value })}
        />
      );
    default:
      return <span className={styles.valuePlaceholder} aria-hidden="true" />;
  }
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, matching the app's icon style)
// ---------------------------------------------------------------------------

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.5h9M5 3.5V2.5h4v1M3.5 3.5l.5 8h6l.5-8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ChevronUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 8.5L7 5l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className={styles.arrowIcon}>
      <path d="M2.5 7h8M7.5 4l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
